const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MODELS_OVERLAY_PATHS = [
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/legal/terms.html',
  '/account/profile.html',
  '/account/assets-manager.html',
  '/admin/index.html',
];

const STATIC_SHARED_HEADER_PATHS = [
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/legal/terms.html',
  '/admin/index.html',
  '/account/profile.html',
  '/account/assets-manager.html',
  '/account/forgot-password.html',
  '/account/reset-password.html',
  '/account/verify-email.html',
];

const COMPACT_HERO_PATHS = [
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/legal/terms.html',
  '/account/profile.html',
  '/account/assets-manager.html',
  '/account/forgot-password.html',
  '/account/reset-password.html',
  '/account/verify-email.html',
];

const FOOTER_COPY_PATHS = [
  '/',
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/legal/terms.html',
  '/admin/index.html',
  '/account/profile.html',
  '/account/assets-manager.html',
  '/account/forgot-password.html',
  '/account/reset-password.html',
  '/account/verify-email.html',
];

const FOOTER_COPY_TEXT = 'BITBI Studio • Built with love & code • © 2026';
const REMOVED_FOOTER_FRAGMENT = ['All', 'experiments', 'are', 'mine'].join(' ');
const HOME_SCROLL_RESTORE_KEY = 'bitbi_home_scroll_restore_v2';

const expectedModelCatalogs = new Map();

function buildNewsPulseItems(prefix = 'mobile-pulse') {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: `${prefix} headline ${index + 1}`,
    summary: `Short source-attributed mobile summary ${index + 1}.`,
    source: `Pulse Source ${index + 1}`,
    url: `https://example.com/${prefix}-${index + 1}`,
    category: prefix.includes('de') ? 'KI' : 'AI',
    published_at: '2026-05-10T08:00:00.000Z',
    visual_type: index === 0 ? 'generated' : 'icon',
    visual_url: index === 0 ? `/api/public/news-pulse/thumbs/${prefix}-${index + 1}` : null,
    visual_thumb_url: index === 0 ? `/api/public/news-pulse/thumbs/${prefix}-${index + 1}` : null,
    visual_alt: index === 0 ? `Generated abstract thumbnail for ${prefix} headline ${index + 1}` : undefined,
  }));
}

async function mockHomepageAuthState(page, { loggedIn }) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(loggedIn
        ? { loggedIn: true, user: { id: 'pulse-member', email: 'pulse@bitbi.ai', role: 'user' } }
        : { loggedIn: false, user: null }),
    });
  });
}

async function getExpectedModelCatalog({ homepage = false } = {}) {
  const cacheKey = homepage ? 'homepage' : 'shared';
  if (expectedModelCatalogs.has(cacheKey)) return expectedModelCatalogs.get(cacheKey);

  const contractModule = await import(
    pathToFileURL(path.join(__dirname, '..', 'js/shared/admin-ai-contract.mjs')).href
  );
  const imageModelsModule = await import(
    pathToFileURL(path.join(__dirname, '..', 'js/shared/ai-image-models.mjs')).href
  );
  const { models } = contractModule.listAdminAiCatalog();
  const liveImageModels = imageModelsModule.getGenerateLabAiImageModelOptions();
  const adminImageModels = Array.isArray(models.image) ? models.image : [];
  const liveImageById = new Map(liveImageModels.map((entry) => [entry.id, entry]));
  const renderedLiveImageIds = new Set();
  const liveMusicIds = new Set([contractModule.ADMIN_AI_MUSIC_MODEL_ID]);
  const liveVideoById = new Map([
    [contractModule.ADMIN_AI_VIDEO_MODEL_ID, { label: 'PixVerse V6' }],
    [contractModule.ADMIN_AI_VIDEO_HAPPYHORSE_T2V_MODEL_ID, { label: contractModule.HAPPYHORSE_T2V_MODEL_LABEL }],
  ]);
  const liveVideoIds = new Set(liveVideoById.keys());

  const imageEntries = [];
  for (const entry of adminImageModels) {
    if (!entry?.id) continue;
    if (homepage && entry.id === contractModule.FLUX_2_DEV_MODEL_ID) continue;
    const liveEntry = liveImageById.get(entry.id);
    if (liveEntry) renderedLiveImageIds.add(entry.id);
    imageEntries.push({
      name: liveEntry?.label || entry.label,
      vendor: entry.vendor,
      status: liveEntry ? 'LIVE' : 'Coming soon',
    });
  }

  for (const entry of liveImageModels) {
    if (!entry?.id || renderedLiveImageIds.has(entry.id)) continue;
    imageEntries.push({
      name: entry.label,
      vendor: entry.vendor || '',
      status: 'LIVE',
    });
  }

  const expectedCatalog = [
    {
      category: 'IMAGE GENERATION',
      models: imageEntries,
    },
    {
      category: 'MUSIC GENERATION',
      models: (models.music || []).map((entry) => ({
        name: entry.label,
        vendor: entry.vendor,
        status: liveMusicIds.has(entry.id) ? 'LIVE' : 'Coming soon',
      })),
    },
    {
      category: 'VIDEO GENERATION',
      models: (models.video || []).map((entry) => ({
        name: liveVideoById.get(entry.id)?.label || entry.label,
        vendor: entry.vendor,
        status: liveVideoIds.has(entry.id) ? 'LIVE' : 'Coming soon',
      })),
    },
  ];

  expectedModelCatalogs.set(cacheKey, expectedCatalog);
  return expectedCatalog;
}

async function expectPathUnchanged(page, expectedPath) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.hash}`;
  }).toBe(expectedPath);
}

function expectWithinPx(actual, expected, label, tolerance = 2) {
  expect(Math.abs(actual - expected), `${label}: ${actual} should be within ${tolerance}px of ${expected}`)
    .toBeLessThanOrEqual(tolerance);
}

async function mockGenerateLabMemberSession(page, {
  email = 'lab@bitbi.ai',
  userId = 'generate-lab-member',
  credits = 900,
} = {}) {
  let logoutRequests = 0;

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loggedIn: true,
        user: { id: userId, email, role: 'user' },
      }),
    });
  });
  await page.route('**/api/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route('**/api/ai/quota', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { creditBalance: credits } }),
    });
  });
  await page.route('**/api/ai/folders', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { folders: [], counts: {}, unfolderedCount: 0 } }),
    });
  });
  await page.route('**/api/ai/assets?limit=6', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { assets: [], next_cursor: null, has_more: false, applied_limit: 6 } }),
    });
  });

  return {
    getLogoutRequests: () => logoutRequests,
  };
}

async function getGenerateLabHeaderMetrics(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`Missing ${selector}`);
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    const logo = document.querySelector('header .site-nav__logo');
    const insetProbe = document.createElement('div');
    insetProbe.style.cssText = [
      'position: fixed',
      'inset-block-start: 0',
      'inset-inline-start: var(--bitbi-public-header-inset)',
      'inline-size: 0',
      'block-size: 0',
      'pointer-events: none',
    ].join(';');
    document.body.appendChild(insetProbe);
    const headerInset = insetProbe.getBoundingClientRect().left;
    insetProbe.remove();
    return {
      viewportWidth: window.innerWidth,
      publicHeaderInset: headerInset,
      logo: rectFor('header .site-nav__logo'),
      headerBar: rectFor('header .site-nav__bar'),
      headerStatus: rectFor('#generateLabHeaderStatus'),
      actions: rectFor('header .site-nav__actions'),
      workspace: rectFor('.generate-lab__desktop'),
      title: rectFor('#generateLabTitle'),
      subtitle: rectFor('.generate-lab__subtitle'),
      logoHref: logo?.getAttribute('href') || null,
      logoTarget: logo?.getAttribute('target') || null,
      logoRel: logo?.getAttribute('rel') || null,
      logoAriaCurrent: logo?.getAttribute('aria-current') || null,
      logoAriaDisabled: logo?.getAttribute('aria-disabled') || null,
    };
  });
}

async function expectGenerateLabHeaderAligned(page, { locale }) {
  await expect(page.locator('#generateLabHeaderStatus')).toBeVisible();
  await expect(page.locator('header .auth-nav__logout')).toBeVisible();
  const metrics = await getGenerateLabHeaderMetrics(page);

  expectWithinPx(metrics.logo.left, metrics.publicHeaderInset, `${locale} Generate Lab public left inset`);
  expectWithinPx(
    metrics.viewportWidth - metrics.actions.right,
    metrics.publicHeaderInset,
    `${locale} Generate Lab public right inset`,
  );
  expectWithinPx(
    metrics.headerStatus.left + (metrics.headerStatus.width / 2),
    metrics.viewportWidth / 2,
    `${locale} Generate Lab center header status`,
  );
  expect(metrics.headerBar.left).toBeLessThan(metrics.workspace.left);
  expect(metrics.headerBar.right).toBeGreaterThan(metrics.workspace.right);
  expect(metrics.title.left).toBeGreaterThan(metrics.logo.left);
  expect(metrics.subtitle.right).toBeLessThan(metrics.actions.right);
  expect(metrics.logoHref).toBeNull();
  expect(metrics.logoTarget).toBeNull();
  expect(metrics.logoRel).toBeNull();
  expect(metrics.logoAriaCurrent).toBe('page');
  expect(metrics.logoAriaDisabled).toBe('true');
}

async function expectModelsOverlayOpenState(page, { homepage = false } = {}) {
  const overlay = page.locator('.models-overlay');
  const expectedCatalog = await getExpectedModelCatalog({ homepage });

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

  const renderedCategories = actualCatalog.map((group) => group.category);
  expect(renderedCategories).toEqual(
    expect.arrayContaining(['IMAGE GENERATION', 'MUSIC GENERATION', 'VIDEO GENERATION']),
  );
  expect(renderedCategories).not.toContain('TEXT GENERATION');
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
    .poll(async () => page.locator('#homeCategories').getAttribute('data-active-category'), { timeout: 10_000 })
    .toBe(expectedCategory);
}

async function waitForHomepageScrollableRange(page, minimumScrollY) {
  await expect
    .poll(async () => page.evaluate(() => (
      Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
        document.body.scrollHeight - window.innerHeight,
      )
    )))
    .toBeGreaterThanOrEqual(minimumScrollY);
}

async function waitForHomepagePersistedScroll(page, minimumScrollY) {
  await expect
    .poll(async () => page.evaluate(({ key, minimumScrollY }) => {
      const stored = Number(sessionStorage.getItem(key));
      const current = Math.round(window.scrollY);
      if (!Number.isFinite(stored) || current < minimumScrollY) return Number.POSITIVE_INFINITY;
      return Math.abs(stored - current);
    }, { key: HOME_SCROLL_RESTORE_KEY, minimumScrollY }), { timeout: 10_000 })
    .toBeLessThanOrEqual(12);
  return page.evaluate(() => Math.round(window.scrollY));
}

async function waitForHomepageCategoryStage(page) {
  const stage = page.locator('#homeCategories');
  await expect
    .poll(async () => (await stage.getAttribute('class')) || '')
    .not.toContain('is-transitioning');
}

async function routeDefaultMemtracks(page, {
  id = 'feedc0de',
  version = 'vpub',
  title = 'Public Member Track',
} = {}) {
  await page.route('**/api/public/news-pulse**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], updated_at: '2026-05-09T08:00:00.000Z' }),
    });
  });

  await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          items: [
            {
              id,
              slug: `memtrack-${id}`,
              title,
              caption: 'Published by Ada Member.',
              category: 'memtracks',
              publisher: { display_name: 'Ada Member' },
              file: { url: `/api/gallery/memtracks/${id}/${version}/file` },
              poster: {
                url: `/api/gallery/memtracks/${id}/${version}/poster`,
                w: 320,
                h: 320,
              },
            },
          ],
          has_more: false,
          next_cursor: null,
          applied_limit: 60,
        },
      }),
    });
  });

  await page.route('**/api/gallery/memtracks/**', async (route) => {
    if (route.request().url().endsWith('/poster')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/webp',
        body: Buffer.from('mock-poster'),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.from('mock-audio'),
    });
  });
}

async function waitForHomepageScrollMeasurementReady(page) {
  await expect(page.locator('#homeCategories')).toHaveAttribute('data-stage-mode', /^(desktop|stacked)$/);
  await expect(page.locator('#videoGrid')).toHaveCount(1);
  await expect
    .poll(async () => page.locator('#videoGrid').evaluate((grid) => (
      grid.children.length + (grid.textContent.trim() ? 1 : 0)
    )))
    .toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
      const media = button.querySelector('.home-categories__arrow-media');
      const mediaRect = media?.getBoundingClientRect() || null;
      const mediaStyle = media ? window.getComputedStyle(media) : null;
      return {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        centerRatio: Math.round((((rect.top + (rect.height / 2)) - stageRect.top) / stageRect.height) * 1000) / 1000,
        target: button.dataset.categoryTarget || '',
        mediaWidth: mediaRect ? Math.round(mediaRect.width * 100) / 100 : 0,
        mediaHeight: mediaRect ? Math.round(mediaRect.height * 100) / 100 : 0,
        mediaBackgroundImage: mediaStyle?.backgroundImage || '',
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

async function waitForHomepageCategoryTransitionMetrics(page, targetCategory, timeout = 2000) {
  const handle = await page.waitForFunction((expectedCategory) => {
    const stage = document.getElementById('homeCategories');
    const navbar = document.getElementById('navbar');
    const prev = stage?.querySelector('[data-category-nav="prev"]:not([hidden])');
    const next = stage?.querySelector('[data-category-nav="next"]:not([hidden])');
    const stageRect = stage?.getBoundingClientRect();
    const navRect = navbar?.getBoundingClientRect();

    const readArrow = (button) => {
      if (!button || !stageRect) return null;
      const rect = button.getBoundingClientRect();
      const media = button.querySelector('.home-categories__arrow-media');
      const mediaRect = media?.getBoundingClientRect() || null;
      const mediaStyle = media ? window.getComputedStyle(media) : null;
      return {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        centerRatio: Math.round((((rect.top + (rect.height / 2)) - stageRect.top) / stageRect.height) * 1000) / 1000,
        target: button.dataset.categoryTarget || '',
        mediaWidth: mediaRect ? Math.round(mediaRect.width * 100) / 100 : 0,
        mediaHeight: mediaRect ? Math.round(mediaRect.height * 100) / 100 : 0,
        mediaBackgroundImage: mediaStyle?.backgroundImage || '',
      };
    };

    const metrics = {
      activeCategory: stage?.dataset.activeCategory || '',
      alignmentDelta: Math.round(Math.abs((stageRect?.top || 0) - (navRect?.bottom || 0)) * 100) / 100,
      isTransitioning: stage?.classList.contains('is-transitioning') || false,
      prev: readArrow(prev),
      next: readArrow(next),
      scrollY: Math.round((window.scrollY || window.pageYOffset || 0) * 100) / 100,
    };

    return metrics.isTransitioning || metrics.activeCategory === expectedCategory ? metrics : null;
  }, targetCategory, { timeout });

  return handle.jsonValue();
}

async function waitForHomepageCategoryAlignment(page) {
  await expect
    .poll(async () => (await readHomepageCategoryStageMetrics(page)).alignmentDelta, { timeout: 10_000 })
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
  test.beforeEach(async ({ page }) => {
    await routeDefaultMemtracks(page);
  });

  test('loads successfully with correct title', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/BITBI/);
  });

  test('homepage Live Pulse requests the English endpoint and renders source links', async ({ page }) => {
    const requestedLocales = [];
    await page.route('**/api/public/news-pulse/thumbs/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/webp',
        body: 'mock-thumb',
      });
    });
    await page.route('**/api/public/news-pulse**', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname !== '/api/public/news-pulse') {
        await route.fallback();
        return;
      }
      requestedLocales.push(requestUrl.searchParams.get('locale'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: Array.from({ length: 6 }, (_, index) => ({
            id: `pulse-test-en-${index + 1}`,
            title: index === 0 ? 'Creative AI workflow update' : `Creative AI workflow update ${index + 1}`,
            summary: `Short source-attributed summary ${index + 1} for the homepage pulse.`,
            source: `Bitbi Test Source ${index + 1}`,
            url: `https://example.com/creative-ai-workflow-${index + 1}`,
            category: 'AI',
            published_at: '2026-05-09T08:00:00.000Z',
            visual_type: index === 0 ? 'generated' : 'icon',
            visual_url: index === 0 ? '/api/public/news-pulse/thumbs/pulse-test-en-1' : null,
            visual_thumb_url: index === 0 ? '/api/public/news-pulse/thumbs/pulse-test-en-1' : null,
            visual_alt: index === 0 ? 'Generated abstract thumbnail for Creative AI workflow update' : undefined,
          })),
          updated_at: '2026-05-09T08:00:00.000Z',
        }),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const pulse = page.locator('#newsPulse');
    await expect(pulse).toHaveAttribute('data-news-pulse-locale', 'en');
    await expect(page.locator('#hero > #newsPulse')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__track')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__track--reverse')).toHaveCount(0);
    await expect(pulse.locator('.news-pulse__item')).toHaveCount(8);
    await expect(pulse.locator('.news-pulse__label')).toHaveText('Bitbi Live Pulse');
    await expect(pulse.getByRole('link', { name: /Creative AI workflow update/ }).first()).toHaveAttribute(
      'href',
      'https://example.com/creative-ai-workflow-1',
    );
    await expect(pulse.locator('.news-pulse__track')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__track--reverse')).toHaveCount(0);
    await expect(pulse.locator('.news-pulse__thumb')).toHaveCount(2);
    await expect(pulse.locator('.news-pulse__link--thumb')).toHaveCount(2);
    await expect(pulse.locator('.news-pulse__thumb').first()).toHaveAttribute(
      'src',
      /\/api\/public\/news-pulse\/thumbs\/pulse-test-en-1$/,
    );
    await expect(pulse.locator('.news-pulse__thumb').first()).toHaveAttribute('loading', 'lazy');
    await expect(pulse.locator('.news-pulse__thumb').first()).toHaveAttribute('decoding', 'async');
    await expect(pulse.locator('.news-pulse__thumb').first()).toHaveAttribute(
      'alt',
      'Generated abstract thumbnail for Creative AI workflow update',
    );
    await expect(pulse.locator('.news-pulse__item').first().locator('.news-pulse__mark')).toHaveCount(0);
    await expect(pulse.locator('.news-pulse__item').nth(1).locator('.news-pulse__mark')).toHaveCount(1);
    const pulseLayout = await pulse.evaluate((node) => {
      const hero = document.querySelector('#hero');
      const nextSection = document.querySelector('#homeCategories');
      const flowStyle = window.getComputedStyle(node.querySelector('.news-pulse__flow'));
      const trackStyle = window.getComputedStyle(node.querySelector('.news-pulse__track'));
      const itemStyle = window.getComputedStyle(node.querySelector('.news-pulse__item'));
      const thumbLinkStyle = window.getComputedStyle(node.querySelector('.news-pulse__link--thumb'));
      const markStyle = window.getComputedStyle(node.querySelector('.news-pulse__mark'));
      const thumbStyle = window.getComputedStyle(node.querySelector('.news-pulse__thumb'));
      const thumbGridColumn = parseFloat((thumbLinkStyle.gridTemplateColumns || '').split(' ')[0] || '0');
      const thumbGap = parseFloat(thumbLinkStyle.columnGap || thumbLinkStyle.gap || '0');
      const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize || '16');
      const rect = node.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const nextRect = nextSection.getBoundingClientRect();
      return {
        parentId: node.parentElement?.id || '',
        trackDisplay: trackStyle.display,
        itemAnimationName: itemStyle.animationName,
        itemAnimationDuration: itemStyle.animationDuration,
        maskImage: flowStyle.maskImage || flowStyle.webkitMaskImage || '',
        flowPaddingInlineStart: parseFloat(flowStyle.paddingInlineStart || '0'),
        markWidth: parseFloat(markStyle.width || '0'),
        thumbWidth: parseFloat(thumbStyle.width || '0'),
        thumbGap,
        thumbTextOffset: thumbGridColumn + thumbGap,
        expectedThumbTextOffset: rootFontSize * 3.47,
        width: rect.width,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        heroLeft: heroRect.left,
        heroTop: heroRect.top,
        heroBottom: heroRect.bottom,
        heroWidth: heroRect.width,
        nextTop: nextRect.top,
      };
    });
    expect(pulseLayout.parentId).toBe('hero');
    expect(pulseLayout.trackDisplay).not.toBe('flex');
    expect(pulseLayout.itemAnimationName).toContain('news-pulse-wheel');
    expect(parseFloat(pulseLayout.itemAnimationDuration)).toBeCloseTo(53.58, 1);
    expect(pulseLayout.maskImage).toContain('linear-gradient');
    expect(pulseLayout.flowPaddingInlineStart).toBeGreaterThan(pulseLayout.markWidth);
    expect(pulseLayout.thumbWidth).toBeGreaterThan(50);
    expect(pulseLayout.thumbWidth).toBeLessThan(58);
    expect(pulseLayout.thumbGap).toBeGreaterThan(1);
    expect(pulseLayout.thumbGap).toBeLessThan(5);
    expect(pulseLayout.thumbTextOffset).toBeCloseTo(pulseLayout.expectedThumbTextOffset, 0);
    expect(pulseLayout.width).toBeGreaterThan(500);
    expect(pulseLayout.left).toBeGreaterThanOrEqual(pulseLayout.heroLeft - 1);
    expect(pulseLayout.right).toBeLessThan(pulseLayout.heroLeft + pulseLayout.heroWidth * 0.62);
    expect(pulseLayout.top).toBeGreaterThanOrEqual(pulseLayout.heroTop - 1);
    expect(pulseLayout.bottom).toBeLessThanOrEqual(pulseLayout.heroBottom + 1);
    expect(pulseLayout.bottom).toBeLessThanOrEqual(pulseLayout.nextTop);
    expect(requestedLocales).toContain('en');
    const renderedIds = await pulse.locator('.news-pulse__item').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-news-pulse-item-id'))
    );
    expect(new Set(renderedIds).size).toBe(6);
    await expect(pulse.locator('.news-pulse__item[aria-hidden="true"]')).toHaveCount(2);
  });

  test('German homepage Live Pulse requests the German endpoint and localizes the layer label', async ({ page }) => {
    const requestedLocales = [];
    await page.route('**/api/public/news-pulse**', async (route) => {
      requestedLocales.push(new URL(route.request().url()).searchParams.get('locale'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 'pulse-test-de',
            title: 'Kreativ-KI Workflow-Update',
            summary: 'Kurze quellenbasierte Zusammenfassung für den Homepage-Puls.',
            source: 'Bitbi Testquelle',
            url: 'https://example.com/kreativ-ki-workflow',
            category: 'KI',
            published_at: '2026-05-09T08:00:00.000Z',
            visual_type: 'icon',
            visual_url: null,
          }],
          updated_at: '2026-05-09T08:00:00.000Z',
        }),
      });
    });

    await page.goto('/de/', { waitUntil: 'domcontentloaded' });
    const pulse = page.locator('#newsPulse');
    await expect(pulse).toHaveAttribute('data-news-pulse-locale', 'de');
    await expect(page.locator('#hero > #newsPulse')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__track')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__track--reverse')).toHaveCount(0);
    await expect(pulse.locator('.news-pulse__item')).toHaveCount(7);
    await expect(pulse.locator('.news-pulse__label')).toHaveText('KI-Puls');
    await expect(pulse.getByRole('link', { name: /Kreativ-KI Workflow-Update/ }).first()).toHaveAttribute(
      'href',
      'https://example.com/kreativ-ki-workflow',
    );
    const pulseLayout = await pulse.evaluate((node) => {
      const hero = document.querySelector('#hero');
      const nextSection = document.querySelector('#homeCategories');
      const rect = node.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const nextRect = nextSection.getBoundingClientRect();
      return {
        parentId: node.parentElement?.id || '',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        heroLeft: heroRect.left,
        heroTop: heroRect.top,
        heroBottom: heroRect.bottom,
        heroWidth: heroRect.width,
        nextTop: nextRect.top,
      };
    });
    expect(pulseLayout.parentId).toBe('hero');
    expect(pulseLayout.left).toBeGreaterThanOrEqual(pulseLayout.heroLeft - 1);
    expect(pulseLayout.right).toBeLessThan(pulseLayout.heroLeft + pulseLayout.heroWidth * 0.62);
    expect(pulseLayout.top).toBeGreaterThanOrEqual(pulseLayout.heroTop - 1);
    expect(pulseLayout.bottom).toBeLessThanOrEqual(pulseLayout.heroBottom + 1);
    expect(pulseLayout.bottom).toBeLessThanOrEqual(pulseLayout.nextTop);
    expect(requestedLocales).toContain('de');
  });

  test('mobile logged-out homepages do not render or fetch Live Pulse news', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockHomepageAuthState(page, { loggedIn: false });
    const requestedUrls = [];
    await page.route('**/api/public/news-pulse**', async (route) => {
      requestedUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 'mobile-hidden-pulse',
            title: 'Hidden mobile pulse',
            summary: 'This should not render on mobile.',
            source: 'Bitbi Test Source',
            url: 'https://example.com/mobile-hidden-pulse',
            category: 'AI',
          }],
          updated_at: '2026-05-09T08:00:00.000Z',
        }),
      });
    });

    for (const path of ['/', '/de/']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#hero')).toBeVisible();
      await expect(page.locator('#newsPulse')).toHaveAttribute('aria-hidden', 'true');
      const pulseState = await page.locator('#newsPulse').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return {
          display: style.display,
          visibility: style.visibility,
          width: rect.width,
          height: rect.height,
          childCount: node.children.length,
          text: node.textContent.trim(),
          ariaHidden: node.getAttribute('aria-hidden'),
        };
      });
      expect(pulseState.display).toBe('none');
      expect(pulseState.visibility).toBe('hidden');
      expect(pulseState.width).toBe(0);
      expect(pulseState.height).toBe(0);
      expect(pulseState.childCount).toBe(0);
      expect(pulseState.text).toBe('');
      expect(pulseState.ariaHidden).toBe('true');
    }

    await page.waitForTimeout(300);
    expect(requestedUrls).toEqual([]);
  });

  for (const { path, locale, label, prefix } of [
    { path: '/', locale: 'en', label: 'Bitbi Live Pulse', prefix: 'mobile-pulse-en' },
    { path: '/de/', locale: 'de', label: 'KI-Puls', prefix: 'mobile-pulse-de' },
  ]) {
    test(`mobile logged-in ${locale} homepage renders member Live Pulse with measured placement`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockHomepageAuthState(page, { loggedIn: true });
      const requestedLocales = [];
      await page.route('**/api/public/news-pulse**', async (route) => {
        requestedLocales.push(new URL(route.request().url()).searchParams.get('locale'));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: buildNewsPulseItems(prefix),
            updated_at: '2026-05-10T08:00:00.000Z',
          }),
        });
      });

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const pulse = page.locator('#newsPulse');
      await expect(pulse.locator('.news-pulse__mobile-item.is-active')).toHaveCount(1, { timeout: 10_000 });
      await expect(pulse.locator('.news-pulse__label')).toHaveText(label);
      await expect(pulse.locator('.news-pulse__track')).toHaveCount(0);
      await expect(pulse.locator('.news-pulse__item')).toHaveCount(0);
      await expect(pulse.locator('.news-pulse__mobile-item')).toHaveCount(1);
      await expect(pulse.locator('.news-pulse__thumb')).toHaveCount(0);
      await expect(pulse.getByRole('link', { name: new RegExp(`${prefix} headline 1`) })).toHaveAttribute(
        'href',
        `https://example.com/${prefix}-1`,
      );

      await expect.poll(async () => pulse.evaluate((node) => node.dataset.newsPulseMobilePlacement || ''))
        .toBe('ready');
      const layout = await pulse.evaluate((node) => {
        const header = document.querySelector('#navbar').getBoundingClientRect();
        const logo = document.querySelector('#hero .hero__title-img').getBoundingClientRect();
        const hero = document.querySelector('#hero').getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        const distance = logo.top - header.bottom;
        return {
          top: rect.top,
          bottom: rect.bottom,
          expectedTop: header.bottom + (distance * 0.05),
          expectedBottom: header.bottom + (distance * 0.95),
          headerBottom: header.bottom,
          logoTop: logo.top,
          heroTop: hero.top,
          heroBottom: hero.bottom,
          display: window.getComputedStyle(node).display,
          visibility: window.getComputedStyle(node).visibility,
          activeTabIndex: node.querySelector('.news-pulse__mobile-item.is-active a')?.tabIndex,
        };
      });
      expect(layout.display).not.toBe('none');
      expect(layout.visibility).toBe('visible');
      expectWithinPx(layout.top, layout.expectedTop, `${locale} mobile pulse top`, 8);
      expectWithinPx(layout.bottom, layout.expectedBottom, `${locale} mobile pulse bottom`, 8);
      expect(layout.top).toBeGreaterThan(layout.headerBottom);
      expect(layout.bottom).toBeLessThan(layout.logoTop);
      expect(layout.top).toBeGreaterThanOrEqual(layout.heroTop - 1);
      expect(layout.bottom).toBeLessThanOrEqual(layout.heroBottom + 1);
      expect(layout.activeTabIndex).toBe(0);
      expect(requestedLocales).toContain(locale);
    });
  }

  test('mobile Live Pulse rotates one active item with cube animation and settles focusability', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mockHomepageAuthState(page, { loggedIn: true });
    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: buildNewsPulseItems('mobile-cube-pulse'),
          updated_at: '2026-05-10T08:00:00.000Z',
        }),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const pulse = page.locator('#newsPulse');
    await expect(pulse.locator('.news-pulse__mobile-item.is-active')).toContainText('mobile-cube-pulse headline 1');
    await page.evaluate(() => {
      window.__bitbiPulseTransitions = [];
      const node = document.querySelector('#newsPulse');
      const observer = new MutationObserver(() => {
        const scene = node?.querySelector('.news-pulse__mobile-cube-scene');
        const cube = node?.querySelector('.news-pulse__mobile-cube.is-turning');
        const front = node?.querySelector('.news-pulse__mobile-cube-face--front');
        const right = node?.querySelector('.news-pulse__mobile-cube-face--right');
        if (!scene || !cube || !front || !right) return;
        window.__bitbiPulseTransitions.push({
          sceneOverflow: window.getComputedStyle(scene).overflow,
          cubeAnimation: window.getComputedStyle(cube).animationName,
          cubeAnimationDuration: window.getComputedStyle(cube).animationDuration,
          cubeTransformStyle: window.getComputedStyle(cube).transformStyle,
          frontBackface: window.getComputedStyle(front).backfaceVisibility,
          rightBackface: window.getComputedStyle(right).backfaceVisibility,
          frontTransform: window.getComputedStyle(front).transform,
          rightTransform: window.getComputedStyle(right).transform,
          settledActiveItems: node.querySelectorAll('.news-pulse__mobile-item.is-active').length,
          transitionFaces: node.querySelectorAll('.news-pulse__mobile-cube-face').length,
          focusableLinks: [...node.querySelectorAll('.news-pulse__mobile-item a')]
            .filter((link) => link.tabIndex >= 0 && !link.hasAttribute('aria-hidden')).length,
        });
      });
      observer.observe(node, { childList: true, subtree: true });
      window.__bitbiPulseTransitionObserver = observer;
    });
    await expect.poll(() => page.evaluate(() => window.__bitbiPulseTransitions?.length || 0), { timeout: 7000 })
      .toBeGreaterThan(0);
    const transition = await page.evaluate(() => window.__bitbiPulseTransitions[0]);
    expect(transition.sceneOverflow).toBe('hidden');
    expect(transition.cubeAnimation).toContain('news-pulse-mobile-cube-turn');
    const durationSeconds = Number.parseFloat(transition.cubeAnimationDuration);
    expect(durationSeconds).toBeGreaterThanOrEqual(1.5);
    expect(durationSeconds).toBeLessThanOrEqual(1.7);
    expect(transition.cubeTransformStyle).toBe('preserve-3d');
    expect(transition.frontBackface).toBe('hidden');
    expect(transition.rightBackface).toBe('hidden');
    expect(transition.frontTransform).not.toBe(transition.rightTransform);
    expect(transition.transitionFaces).toBe(2);
    expect(transition.settledActiveItems).toBe(0);
    expect(transition.focusableLinks).toBe(0);

    await expect(pulse.locator('.news-pulse__mobile-item.is-active')).toContainText('mobile-cube-pulse headline 2', {
      timeout: 4500,
    });
    await expect(pulse.locator('.news-pulse__mobile-item')).toHaveCount(1);
    const settled = await pulse.evaluate((node) => ({
      activeItems: node.querySelectorAll('.news-pulse__mobile-item.is-active').length,
      activeLinks: [...node.querySelectorAll('.news-pulse__mobile-item.is-active a')]
        .filter((link) => link.tabIndex >= 0 && !link.hasAttribute('aria-hidden')).length,
    }));
    expect(settled.activeItems).toBe(1);
    expect(settled.activeLinks).toBe(1);
  });

  test('mobile Live Pulse initializes after login and clears after logout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let loggedIn = false;
    const requestedUrls = [];
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(loggedIn
          ? { loggedIn: true, user: { id: 'pulse-transition', email: 'pulse-transition@bitbi.ai', role: 'user' } }
          : { loggedIn: false, user: null }),
      });
    });
    await page.route('**/api/login', async (route) => {
      loggedIn = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.route('**/api/logout', async (route) => {
      loggedIn = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.route('**/api/public/news-pulse**', async (route) => {
      requestedUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: buildNewsPulseItems('mobile-auth-pulse'),
          updated_at: '2026-05-10T08:00:00.000Z',
        }),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#newsPulse')).toHaveAttribute('aria-hidden', 'true');
    await page.waitForTimeout(250);
    expect(requestedUrls).toEqual([]);

    await page.evaluate(async () => {
      const { authLogin } = await import('/js/shared/auth-state.js');
      await authLogin('pulse-transition@bitbi.ai', 'password');
    });
    await expect(page.locator('#newsPulse .news-pulse__mobile-item.is-active')).toContainText('mobile-auth-pulse headline 1');
    expect(requestedUrls).toHaveLength(1);

    await page.evaluate(async () => {
      const { authLogout } = await import('/js/shared/auth-state.js');
      await authLogout();
    });
    await expect(page.locator('#newsPulse')).toHaveAttribute('aria-hidden', 'true');
    const cleared = await page.locator('#newsPulse').evaluate((node) => ({
      childCount: node.children.length,
      focusableLinks: node.querySelectorAll('a[href]:not([tabindex="-1"])').length,
      text: node.textContent.trim(),
      display: window.getComputedStyle(node).display,
    }));
    expect(cleared.childCount).toBe(0);
    expect(cleared.focusableLinks).toBe(0);
    expect(cleared.text).toBe('');
    expect(cleared.display).toBe('none');
  });

  test('homepage Live Pulse handles failed endpoint responses without breaking the page', async ({ page }) => {
    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('#hero > #newsPulse')).toHaveCount(1);
    await expect(page.locator('#newsPulse .news-pulse__empty')).toHaveText('Live Pulse is warming up.');
  });

  test('refreshing mid-page preserves the current scroll position', async ({ page }) => {
    await page.goto('/');
    await waitForHomepageScrollMeasurementReady(page);
    await page.evaluate((key) => sessionStorage.removeItem(key), HOME_SCROLL_RESTORE_KEY);
    await waitForHomepageScrollableRange(page, 900);

    await page.evaluate(() => window.scrollTo(0, 760));
    await expect
      .poll(async () => page.evaluate(() => Math.round(window.scrollY)), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(740);
    const beforeReload = await waitForHomepagePersistedScroll(page, 740);

    await page.reload();

    await expect.poll(async () => {
      const currentScroll = await page.evaluate(() => Math.round(window.scrollY));
      return Math.abs(currentScroll - beforeReload);
    }, { timeout: 10_000 }).toBeLessThanOrEqual(12);
  });

  test('refreshing near the category stage does not auto-jump the stage under the header', async ({ page }) => {
    await page.goto('/');
    await waitForHomepageScrollMeasurementReady(page);
    await page.evaluate((key) => sessionStorage.removeItem(key), HOME_SCROLL_RESTORE_KEY);

    const beforeReload = await page.evaluate(async () => {
      const stage = document.getElementById('homeCategories');
      const navbar = document.getElementById('navbar');
      const absoluteTop = window.scrollY + stage.getBoundingClientRect().top;
      const navBottom = navbar.getBoundingClientRect().bottom;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const maxSafeScroll = Math.max(0, absoluteTop - navBottom - 121);
      const targetScroll = Math.min(maxScroll, maxSafeScroll, Math.max(24, absoluteTop - 260));
      window.scrollTo(0, targetScroll);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const stageRect = stage.getBoundingClientRect();
      const navRect = navbar.getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        alignmentDelta: Math.round(Math.abs(stageRect.top - navRect.bottom)),
      };
    });

    expect(beforeReload.alignmentDelta).toBeGreaterThan(120);
    beforeReload.scrollY = await waitForHomepagePersistedScroll(page, Math.max(1, beforeReload.scrollY));
    const beforePersistedAlignment = await readHomepageCategoryStageMetrics(page);
    expect(beforePersistedAlignment.alignmentDelta).toBeGreaterThan(120);

    await page.reload();

    await expect
      .poll(async () => (await readHomepageCategoryStageMetrics(page)).alignmentDelta, { timeout: 10_000 })
      .toBeGreaterThan(120);
  });

  test('desktop homepage header aligns the public nav group and removes the mood pill', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    for (const { path, labels, pricingHref } of [
      { path: '/', labels: ['Gallery', 'Video', 'Sound Lab', 'Pricing'], pricingHref: '/pricing.html' },
      { path: '/de/', labels: ['Galerie', 'Video', 'Sound Lab', 'Preise'], pricingHref: '/de/pricing.html' },
    ]) {
      await page.goto(path);
      const nav = page.locator('#navbar .site-nav__links');

      await expect(nav.getByRole('link', { name: labels[0] })).toBeVisible();
      await expect(nav.getByRole('link', { name: labels[1] })).toBeVisible();
      await expect(nav.getByRole('link', { name: labels[2] })).toBeVisible();
      await expect(nav.getByRole('link', { name: labels[3] })).toHaveAttribute('href', pricingHref);
      await expect(nav.getByRole('link', { name: 'Contact' })).toHaveCount(0);
      await expect(nav.getByRole('button', { name: 'Models' })).toHaveCount(0);
      await expect(page.locator('#hero > #newsPulse')).toHaveCount(1);

      await expect
        .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
        .toEqual(labels);

      const metrics = await page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            width: box.width,
          };
        };
        const mood = document.querySelector('#navbar .site-nav__mood');
        return {
          viewportWidth: window.innerWidth,
          logo: rect('#navbar .site-nav__logo'),
          pulse: rect('#hero > #newsPulse'),
          gallery: rect('#navbar [data-category-link="gallery"]'),
          video: rect('#navbar [data-category-link="video"]'),
          sound: rect('#navbar [data-category-link="sound"]'),
          actions: rect('#navbar .site-nav__actions'),
          moodDisplay: mood ? window.getComputedStyle(mood).display : null,
          moodWidth: mood ? mood.getBoundingClientRect().width : null,
        };
      });

      expect(metrics.logo).toBeTruthy();
      expect(metrics.pulse).toBeTruthy();
      expect(metrics.gallery.right).toBeLessThan(metrics.video.left);
      expect(metrics.sound.left).toBeGreaterThan(metrics.video.right);
      expectWithinPx(
        metrics.video.left + (metrics.video.width / 2),
        metrics.viewportWidth / 2,
        `${path} video nav center`,
        2,
      );
      expectWithinPx(metrics.logo.left, metrics.pulse.left, `${path} logo/news left inset`, 4);
      expectWithinPx(
        metrics.viewportWidth - metrics.actions.right,
        metrics.logo.left,
        `${path} right actions inset`,
        4,
      );
      expect(metrics.moodDisplay).toBe('none');
      expect(metrics.moodWidth).toBe(0);
    }
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
      if (target.category === 'sound') {
        await expect(page.locator('#soundLabTracks .snd-card--memtrack').first()).toBeVisible();
        await waitForHomepageCategoryStage(page);
      }
      await waitForHomepageCategoryAlignment(page);
    }
  });

  test('homepage category carousel defaults to Video Creations and navigates the three staged states safely', async ({ page }) => {
    test.setTimeout(45_000);

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

    await expect(stage).toHaveAttribute('data-stage-mode', 'desktop');
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');
    await expect(stage.locator('[data-category-nav]')).toHaveCount(0);
    await expect(page.locator('.home-categories__arrow')).toHaveCount(0);
    await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();

    const initialStageMetrics = await readHomepageCategoryStageMetrics(page);
    expect(initialStageMetrics.prev).toBeNull();
    expect(initialStageMetrics.next).toBeNull();

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    const midTransitionMetrics = await waitForHomepageCategoryTransitionMetrics(page, 'gallery');
    expect(midTransitionMetrics.isTransitioning || midTransitionMetrics.activeCategory === 'gallery').toBe(true);
    expect(midTransitionMetrics.alignmentDelta).toBeLessThanOrEqual(initialStageMetrics.alignmentDelta);

    await expectActiveHomepageCategory(page, 'gallery');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'gallery');
    await expect(page.locator('#galleryGrid .gallery-item').filter({ hasText: 'Staged Gallery Card' })).toBeVisible();

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Sound Lab' }).click();
    await expectActiveHomepageCategory(page, 'sound');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'sound');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    const midHeaderNavMetrics = await waitForHomepageCategoryTransitionMetrics(page, 'gallery');
    expect(midHeaderNavMetrics.isTransitioning || midHeaderNavMetrics.activeCategory === 'gallery').toBe(true);
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
    await expect(stage.locator('[data-category-nav]')).toHaveCount(0);

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
      await expect(stage.locator('[data-category-nav]')).toHaveCount(0);

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

  test('MODELS opens the homepage models overlay from the hero CTA without navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');

    await expect(page.locator('#navbar .site-nav__links').getByRole('button', { name: 'Models' })).toHaveCount(0);
    const modelsButton = page.locator('#hero .hero__models-cta');
    const modelsImage = modelsButton.locator('img.hero__models-cta-image');
    await expect(modelsButton).toHaveCount(1);
    await expect(modelsButton).toBeVisible();
    await expect(modelsButton).toHaveAccessibleName('Open Models');
    await expect(modelsButton).not.toContainText('Models');
    await expect(modelsImage).toBeVisible();
    await expect(modelsImage).toHaveAttribute('src', /\/assets\/images\/botton\/pivimu\.webp$/);
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page, { homepage: true });

    await page.getByRole('button', { name: 'Close models' }).click();
    await expect(page.locator('.models-overlay')).not.toHaveClass(/is-active/);
    await expectPathUnchanged(page, '/');
  });

  for (const { path, galleryLabel } of [
    { path: '/', galleryLabel: 'Gallery' },
    { path: '/de/', galleryLabel: 'Galerie' },
  ]) {
    test(`homepage Models image sits on the right below the header without crowding ${galleryLabel} on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.route('**/api/public/news-pulse**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], updated_at: '2026-05-09T08:00:00.000Z' }),
        });
      });

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const modelsButton = page.locator('#hero .hero__models-cta');
      await expect(modelsButton).toBeVisible();

      const layout = await page.evaluate(() => {
        const cta = document.querySelector('#hero .hero__models-cta').getBoundingClientRect();
        const pulse = document.querySelector('#newsPulse').getBoundingClientRect();
        const hero = document.querySelector('#hero').getBoundingClientRect();
        const nav = document.querySelector('#navbar').getBoundingClientRect();
        const guest = document.querySelector('#mobileGuestBanner')?.getBoundingClientRect();
        const guestClear = !guest?.width || !guest?.height || (
          guest.right <= cta.left - 8 ||
          guest.left >= cta.right + 8 ||
          guest.bottom <= cta.top - 8 ||
          guest.top >= cta.bottom + 8
        );
        return {
          ctaRightInset: hero.right - cta.right,
          pulseLeftInset: pulse.left - hero.left,
          ctaTop: cta.top,
          ctaLeft: cta.left,
          ctaRight: cta.right,
          heroLeft: hero.left,
          heroRight: hero.right,
          heroTop: hero.top,
          heroWidth: hero.width,
          navBottom: nav.bottom,
          guestClear,
        };
      });

      expect(Math.abs(layout.ctaRightInset - layout.pulseLeftInset)).toBeLessThanOrEqual(2);
      expect(layout.ctaLeft).toBeGreaterThan(layout.heroLeft + layout.heroWidth * 0.72);
      expect(layout.ctaRight).toBeLessThanOrEqual(layout.heroRight - layout.pulseLeftInset + 1);
      expect(layout.ctaTop).toBeGreaterThan(layout.navBottom);
      expect(layout.ctaTop - layout.navBottom).toBeLessThanOrEqual(28);
      expect(layout.guestClear).toBe(true);
    });
  }

  test('homepage hero video uses the intended 1.5x playback speed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-hero-video]')).toHaveCount(1);
    await expect.poll(() => page.locator('[data-hero-video]').evaluate((video) => video.playbackRate)).toBe(1.5);
    await expect.poll(() => page.locator('[data-hero-video]').evaluate((video) => video.defaultPlaybackRate)).toBe(1.5);
  });

  test('MODELS opens the homepage models overlay from the mobile navigation without navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('#hero .hero__models-cta')).toBeHidden();
    await page.getByRole('button', { name: 'Toggle menu' }).click();
    const mobileExplore = page.locator('#mobileNav .mobile-nav__section[aria-label="Explore"]');
    const mobileConnect = page.locator('#mobileNav .mobile-nav__section[aria-label="Connect"]');
    await expect(mobileExplore.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect(mobileConnect.getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect
      .poll(() => mobileExplore.locator(':scope > .mobile-nav__link').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Pricing', 'Models']);

    const modelsButton = page.locator('#mobileNav').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page, { homepage: true });
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
    await expect(teaser).toContainText('Open Lab');
    await expect(hero.locator('.hero__lab-teaser-icon')).toHaveText('⚗️');
    await expect(teaser).toHaveAttribute('href', '/generate-lab/');
    await expect(teaser).toHaveAttribute('target', 'bitbi-generate-lab');
    await expect(teaser).toHaveAttribute('rel', /noopener/);
    await expect(teaser).toHaveAttribute('rel', /noreferrer/);

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
    expect(teaserMetrics.pointerEvents).not.toBe('none');
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
    await expect(teaser).toContainText('Open Lab');
    await expect(teaser).toHaveAttribute('href', '/generate-lab/');
    await expect(teaser).toHaveAttribute('target', 'bitbi-generate-lab');
    await expect(teaser).toHaveAttribute('rel', /noopener/);
    await expect(teaser).toHaveAttribute('rel', /noreferrer/);
  });

  test('English Generate Lab header uses public outer insets and disables the current-page brand link', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    const session = await mockGenerateLabMemberSession(page, {
      email: 'align@bitbi.ai',
      userId: 'generate-lab-align-member',
      credits: 320,
    });

    await page.goto('/generate-lab/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Desktop Workspace');
    await expect(page.locator('header .site-nav__mood')).toBeVisible();
    await expect(page.locator('header .locale-switcher__link[hreflang="de"]')).toHaveAttribute('href', '/de/generate-lab/');
    await expect(page.locator('#labAssetsOpen')).toBeVisible();
    await expect(page.locator('header .auth-nav__logout')).toHaveText('Sign Out');
    await expectGenerateLabHeaderAligned(page, { locale: 'English' });

    await page.evaluate(() => { window.__generateLabBrandMarker = 'still-here'; });
    await page.locator('header .site-nav__logo').click();
    await expectPathUnchanged(page, '/generate-lab/');
    await expect.poll(() => page.evaluate(() => window.__generateLabBrandMarker)).toBe('still-here');

    await page.locator('header .auth-nav__logout').click();
    await expect.poll(() => session.getLogoutRequests()).toBe(1);
    await expect(page.locator('header .site-nav__cta')).toHaveText('Sign In');
  });

  test('German Generate Lab header uses public outer insets and disables the current-page brand link', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    const session = await mockGenerateLabMemberSession(page, {
      email: 'ausrichtung@bitbi.ai',
      userId: 'generate-lab-ausrichtung-member',
      credits: 640,
    });

    await page.goto('/de/generate-lab/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Desktop-Arbeitsbereich');
    await expect(page.locator('header .site-nav__mood')).toBeVisible();
    await expect(page.locator('header .locale-switcher__link[hreflang="en"]')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#labAssetsOpen')).toBeVisible();
    await expect(page.locator('header .auth-nav__logout')).toHaveText('Abmelden');
    await expectGenerateLabHeaderAligned(page, { locale: 'German' });

    await page.evaluate(() => { window.__generateLabBrandMarker = 'still-here'; });
    await page.locator('header .site-nav__logo').click();
    await expectPathUnchanged(page, '/de/generate-lab/');
    await expect.poll(() => page.evaluate(() => window.__generateLabBrandMarker)).toBe('still-here');

    await page.locator('header .auth-nav__logout').click();
    await expect.poll(() => session.getLogoutRequests()).toBe(1);
    await expect(page.locator('header .site-nav__cta')).toHaveText('Anmelden');
  });

  test('Generate Lab renders the desktop member workspace with supported models', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-member', email: 'lab@bitbi.ai', role: 'user' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { creditBalance: 900 } }),
      });
    });
    await page.route('**/api/ai/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { folders: [], counts: {}, unfolderedCount: 0 } }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { assets: [], next_cursor: null, has_more: false, applied_limit: 6 } }),
      });
    });
    await page.goto('/generate-lab/');

    const workspace = page.locator('.generate-lab__desktop');
    await expect(workspace).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Generate Lab' })).toBeVisible();
    await expect(page.getByText('Member Workspace')).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Gallery' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Video' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Sound Lab' })).toHaveCount(0);
    await expect(page.locator('header .site-nav__logo')).not.toHaveAttribute('href', /./);
    await expect(page.locator('header .site-nav__logo')).not.toHaveAttribute('target', /./);
    await expect(page.locator('header .site-nav__logo')).not.toHaveAttribute('rel', /./);
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Desktop Workspace');
    await expect(page.locator('header')).not.toContainText(['Generate Lab', 'is', 'Desktop Workspace'].join(' '));
    await expect(page.locator('#globalAudioShell')).toHaveCount(0);
    await expect(page.locator('#generateLabHeaderStatus')).toBeVisible();
    await expect(page.locator('#labAccountStatus')).toContainText('Signed in as lab@bitbi.ai');
    await expect(page.locator('#labCreditStatus')).toHaveText('900 credits');
    await expect(page.locator('#labAssetsOpen')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Images' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Video' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Music' })).toBeVisible();
    await expect(page.getByLabel('Describe your image')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in to Generate|Generate/i })).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('1 credit');
    await expect(page.locator('.generate-lab__subtitle')).toHaveCSS('text-align', 'right');
    const expectLabAccent = async (primary, alt) => {
      const values = await page.locator('body').evaluate((node) => {
        const style = window.getComputedStyle(node);
        return {
          primary: style.getPropertyValue('--lab-accent-rgb').trim(),
          alt: style.getPropertyValue('--lab-accent-alt-rgb').trim(),
        };
      });
      expect(values).toEqual({ primary, alt });
    };
    await expect(page.locator('#labModelList').getByText('FLUX.1 Schnell')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('FLUX.2 Klein 9B')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('GPT Image 2')).toBeVisible();
    await expectLabAccent('192, 38, 211', '0, 240, 255');

    await page.selectOption('#labImageModel', 'openai/gpt-image-2');
    await expect(page.locator('#labImageGptControls')).toBeVisible();
    await expect(page.locator('#labImageFluxControls')).toBeHidden();
    await expect(page.locator('#labImageQuality')).toBeVisible();
    await expect(page.locator('#labImageSize')).toBeVisible();
    await expect(page.locator('#labImageOutputFormat')).toBeVisible();
    await expect(page.locator('#labImageBackground')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('50 credits');
    await expect(page.locator('#labImageRefPrimary .generate-lab-ref-images__slot')).toHaveCount(3);
    await expect(page.locator('#labImageRefExtra')).toBeHidden();
    await page.locator('#labImageRefToggle').click();
    await expect(page.locator('#labImageRefExtra')).toBeVisible();
    await expect(page.locator('#labImageRefExtraGrid .generate-lab-ref-images__slot')).toHaveCount(13);
    await page.locator('#labImageReference4').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(page.locator('#labImageReferenceCount')).toHaveText('1 / 16');
    await page.locator('#labImageRefToggle').click();
    await expect(page.locator('#labImageRefExtra')).toBeHidden();
    await expect(page.locator('#labImageRefToggle')).toContainText('More reference images (1 selected)');
    await page.locator('#labImageRefToggle').click();
    await expect(page.locator('#labImageRefExtra')).toBeVisible();
    await expect(page.locator('#labImageRefExtraGrid')).toContainText('reference.png');
    await expect(page.locator('#labImageReferenceCostHint')).toBeVisible();
    await page.selectOption('#labImageQuality', 'low');
    await expect(page.locator('#labCost')).toHaveText('35 credits');
    await page.selectOption('#labImageQuality', 'auto');
    await expect(page.locator('#labCost')).toHaveText('250 credits');
    await expect(page.locator('#labImageAutoCostHint')).toBeVisible();
    await page.selectOption('#labImageModel', '@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#labImageGptControls')).toBeHidden();
    await expect(page.locator('#labImageFluxControls')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('1 credit');

    await page.selectOption('#labImageModel', '@cf/black-forest-labs/flux-2-klein-9b');
    await expect(page.locator('#labCost')).toHaveText('10 credits');
    await expect(page.locator('#labImageSteps')).toBeDisabled();
    await expect(page.locator('#labImageSeed')).toBeDisabled();
    await page.selectOption('#labImageModel', '@cf/black-forest-labs/flux-1-schnell');
    await expect(page.locator('#labCost')).toHaveText('1 credit');
    await expect(page.locator('#labImageSteps')).toBeEnabled();
    await expect(page.locator('#labImageSeed')).toBeEnabled();

    const titleMetrics = await page.locator('#generateLabTitle').evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return { width: box.width, fontSize: Number.parseFloat(style.fontSize) };
    });
    expect(titleMetrics.fontSize).toBeLessThanOrEqual(32);

    await page.getByRole('tab', { name: 'Video' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-lab-mode', 'video');
    await expectLabAccent('0, 240, 255', '255, 179, 0');
    await expect(page.locator('#labModelList').getByText('PixVerse V6')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('HappyHorse 1.0 T2V')).toBeVisible();
    await expect(page.getByLabel('Describe your video')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('185 credits');
    await expect(page.getByText('Vidu Q3 Pro')).toHaveCount(0);

    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'HappyHorse 1.0 T2V' }).click();
    await expect(page.locator('#labCost')).toHaveText('459 credits');
    await expect(page.locator('#labVideoNegativeField')).toBeHidden();
    await expect(page.locator('#labVideoReferenceField')).toBeHidden();
    await expect(page.locator('#labVideoAudioField')).toBeHidden();
    await expect(page.locator('#labVideoWatermarkField')).toBeVisible();
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Resolution');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Ratio');
    await expect(page.locator('#labVideoDuration option').first()).toHaveAttribute('value', '3');
    await expect(page.locator('#labVideoQuality option')).toHaveText(['720P', '1080P']);
    await expect(page.locator('#labVideoAspect option')).toHaveText(['16:9', '9:16', '1:1', '4:3', '3:4']);
    await expect(page.locator('#labVideoAspect option[value="21:9"]')).toHaveCount(0);
    await page.selectOption('#labVideoQuality', '1080P');
    await expect(page.locator('#labCost')).toHaveText('917 credits');
    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'PixVerse V6' }).click();
    await expect(page.locator('#labCost')).toHaveText('185 credits');
    await expect(page.locator('#labVideoNegativeField')).toBeVisible();
    await expect(page.locator('#labVideoReferenceField')).toBeVisible();
    await expect(page.locator('#labVideoAudioField')).toBeVisible();
    await expect(page.locator('#labVideoWatermarkField')).toBeHidden();
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Quality');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Aspect');

    await page.getByRole('tab', { name: 'Music' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-lab-mode', 'music');
    await expectLabAccent('255, 179, 0', '0, 240, 255');
    await expect(page.locator('#labModelList').getByText('MiniMax Music 2.6')).toBeVisible();
    await expect(page.getByLabel('Describe your track')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('150 credits');
  });

  test('German Generate Lab shows HappyHorse video controls with localized labels', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-de-member', email: 'labor@bitbi.ai', role: 'user' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { creditBalance: 900 } }),
      });
    });
    await page.route('**/api/ai/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { folders: [], counts: {}, unfolderedCount: 0 } }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { assets: [], next_cursor: null, has_more: false, applied_limit: 6 } }),
      });
    });
    await page.goto('/de/generate-lab/');

    await page.getByRole('tab', { name: 'Video' }).click();
    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'HappyHorse 1.0 T2V' }).click();
    await expect(page.locator('#labVideoNegativeField')).toBeHidden();
    await expect(page.locator('#labVideoReferenceField')).toBeHidden();
    await expect(page.locator('#labVideoAudioField')).toBeHidden();
    await expect(page.locator('#labVideoWatermarkField')).toBeVisible();
    await expect(page.locator('#labVideoWatermarkField')).toContainText('Wasserzeichen');
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Auflösung');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Seitenverhältnis');
    await expect(page.locator('#labVideoQuality option')).toHaveText(['720P', '1080P']);
    await expect(page.locator('#labVideoAspect option')).toHaveText(['16:9', '9:16', '1:1', '4:3', '3:4']);
  });

  test('Generate Lab opens Assets Manager as an in-page overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-assets-member', email: 'assets@bitbi.ai', role: 'user' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { creditBalance: 400 } }),
      });
    });
    await page.route('**/api/ai/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            folders: [{ id: 'folder-one', name: 'Lab saves' }],
            counts: { 'folder-one': 1 },
            unfolderedCount: 0,
          },
        }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { assets: [], next_cursor: null, has_more: false, applied_limit: 6 } }),
      });
    });

    await page.goto('/generate-lab/');
    const popupPromise = page.waitForEvent('popup', { timeout: 750 }).catch(() => null);
    await page.locator('#labAssetsOpen').click();
    expect(await popupPromise).toBeNull();

    const overlay = page.getByRole('dialog', { name: 'Assets Manager' });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Close Assets Manager' })).toBeVisible();
    await expect(overlay.locator('#labAssetsNewFolderBtn')).toBeVisible();
    await expect(overlay.locator('#labAssetsSelectBtn')).toBeVisible();
    await overlay.getByRole('button', { name: 'Close Assets Manager' }).click();
    await expect(overlay).toBeHidden();
  });

  test('Generate Lab opens recent image, video, and audio assets in the preview stage', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function playStub() {
        this.dataset.playRequested = 'true';
        return Promise.resolve();
      };
    });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-recent-member', email: 'recent@bitbi.ai', role: 'user' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { creditBalance: 400 } }),
      });
    });
    await page.route('**/api/ai/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { folders: [], counts: {}, unfolderedCount: 0 } }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            assets: [
              {
                id: 'recent-img',
                asset_type: 'image',
                title: 'Neon image',
                thumb_url: '/api/ai/images/recent-img/thumb',
                medium_url: '/api/ai/images/recent-img/medium',
                file_url: '/api/ai/images/recent-img/file',
                created_at: '2026-05-05T10:00:00.000Z',
              },
              {
                id: 'recent-vid',
                asset_type: 'video',
                source_module: 'video',
                title: 'Neon video',
                poster_url: '/api/ai/text-assets/recent-vid/poster',
                file_url: '/api/ai/text-assets/recent-vid/file',
                mime_type: 'video/mp4',
                created_at: '2026-05-05T09:00:00.000Z',
              },
              {
                id: 'recent-audio',
                asset_type: 'sound',
                source_module: 'music',
                title: 'Neon track',
                poster_url: '/api/ai/text-assets/recent-audio/poster',
                file_url: '/api/ai/text-assets/recent-audio/file',
                mime_type: 'audio/mpeg',
                created_at: '2026-05-05T08:00:00.000Z',
              },
            ],
            next_cursor: null,
            has_more: false,
            applied_limit: 6,
          },
        }),
      });
    });
    await page.route('**/api/ai/images/recent-img/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=', 'base64'),
      });
    });
    await page.route('**/api/ai/text-assets/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: route.request().url().includes('poster') ? 'image/png' : 'application/octet-stream',
        body: Buffer.from('preview'),
      });
    });

    await page.goto('/generate-lab/');

    await page.getByRole('button', { name: 'Open Neon image in Generate Lab preview' }).click();
    await expect(page.locator('#labResultStage .generate-lab__image-output')).toBeVisible();
    await expect(page.locator('#labResultStage .generate-lab__image-output')).toHaveAttribute('src', /recent-img\/medium/);
    await expect(page.locator('#globalAudioShell')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open Neon video in Generate Lab preview' }).click();
    await expect(page.locator('#labResultStage video.generate-lab__video-output')).toBeVisible();
    await expect(page.locator('#labResultStage video.generate-lab__video-output')).toHaveAttribute('src', /recent-vid\/file/);
    await expect(page.locator('#labResultStage video.generate-lab__video-output')).toHaveAttribute('data-play-requested', 'true');
    await expect(page.locator('#globalAudioShell')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open Neon track in Generate Lab preview' }).click();
    await expect(page.locator('#labResultStage audio.generate-lab__audio-output')).toBeVisible();
    await expect(page.locator('#labResultStage audio.generate-lab__audio-output')).toHaveAttribute('src', /recent-audio\/file/);
    await expect(page.locator('#labResultStage audio.generate-lab__audio-output')).toHaveAttribute('data-play-requested', 'true');
    await expect(page.locator('#globalAudioShell')).toHaveCount(0);
  });

  test('Generate Lab return context rewrites subpage home links without changing homepage-origin behavior', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-context-member', email: 'context@bitbi.ai', role: 'user' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { creditBalance: 100 } }),
      });
    });
    await page.route('**/api/ai/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { folders: [], counts: {}, unfolderedCount: 0 } }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { assets: [], next_cursor: null, has_more: false, applied_limit: 6 } }),
      });
    });

    await page.goto('/generate-lab/');
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Desktop Workspace');
    await page.goto('/legal/imprint.html');

    await expect(page.locator('header .site-nav__context-label')).toHaveText('Desktop Workspace');
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('header').getByRole('link', { name: 'Gallery' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Video' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Sound Lab' })).toHaveCount(0);
    await expect(page.locator('.back-link--sm')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#globalAudioShell')).toHaveCount(0);
    await page.locator('header .site-nav__logo').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/generate-lab/');

    await page.route('**/api/profile', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Sign in required.' }),
      });
    });
    await page.goto('/account/profile.html?returnContext=generate-lab');
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Desktop Workspace');
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#deniedState .profile__link')).toHaveAttribute('href', '/generate-lab/');

    await page.goto('/');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('bitbi:return-context'))).toBeNull();
    await page.goto('/legal/imprint.html');
    await expect(page.locator('header .site-nav__context-label:visible')).toHaveCount(0);
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('href', '/');
  });

  test('Generate Lab shows the desktop-optimized message on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/generate-lab/');

    await expect(page.locator('.generate-lab__mobile-fallback')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Desktop workspace' })).toBeVisible();
    await expect(page.getByText('Generate Lab is optimized for desktop creation workflows.')).toBeVisible();
    await expect(page.locator('.generate-lab__desktop')).toBeHidden();
  });

  test('repo footers use the shortened footer sentence and end cleanly', async ({ page }) => {
    for (const pathname of FOOTER_COPY_PATHS) {
      await page.goto(pathname);

      const footerCopy = page.locator('.site-footer__copy');
      await expect(footerCopy).toHaveCount(1);
      await expect(footerCopy).toHaveText(FOOTER_COPY_TEXT);
      await expect(page.getByText(REMOVED_FOOTER_FRAGMENT)).toHaveCount(0);

      const footerStructure = await page.evaluate(() => {
        const footerInner = document.querySelector('.site-footer__inner');
        const footerCopyEl = footerInner?.querySelector('.site-footer__copy');
        return {
          footerCopyIsLastChild: Boolean(footerInner && footerCopyEl && footerInner.lastElementChild === footerCopyEl),
          emptyParagraphCount: footerInner
            ? Array.from(footerInner.querySelectorAll('p')).filter((node) => !node.textContent.trim()).length
            : 0,
        };
      });

      expect(footerStructure.footerCopyIsLastChild).toBe(true);
      expect(footerStructure.emptyParagraphCount).toBe(0);
    }
  });

  test('hero uses the mobile background video asset on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect
      .poll(() => page.locator('[data-hero-video]').evaluate((el) => el.currentSrc))
      .toContain('/assets/images/hero/hero-flow-mobile.mp4');
  });

  test('Contact hash navigation aligns the footer contact row flush with the header', async ({ page }) => {
    await page.goto('/#contact');

    await expect(page.locator('#contactDrawerTrigger')).toBeInViewport();
    await expect.poll(() => page.evaluate(() => Boolean(document.getElementById('contact')?.closest('.site-footer__inner')))).toBe(true);
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

  test('footer contact drawer is collapsed by default on desktop and preserves submit behavior when expanded', async ({ page }) => {
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
    const brand = page.locator('.site-footer__brand');
    const socialLink = page.locator('#contact .site-footer__social-link[aria-label="X (Twitter)"]');

    await expect(trigger).toBeVisible();
    await expect(brand).toBeVisible();
    await expect(socialLink).toBeVisible();
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
      const contactRoot = document.getElementById('contact');
      const brandEl = document.querySelector('.site-footer__brand');
      const socialEl = document.querySelector('#contact .site-footer__social-link[aria-label="X (Twitter)"]');
      const drawerRect = drawerEl?.getBoundingClientRect();
      const triggerRect = triggerEl?.getBoundingClientRect();
      const exploreBtnRect = exploreBtnEl?.getBoundingClientRect();
      const brandRect = brandEl?.getBoundingClientRect();
      const socialRect = socialEl?.getBoundingClientRect();
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
        triggerCount: document.querySelectorAll('#contactDrawerTrigger').length,
        insideFooter: Boolean(contactRoot?.closest('footer')),
        legacyContactSectionCount: document.querySelectorAll('main > section[aria-label="Contact"]').length,
        brandTriggerOverlap: Math.round((
          Math.min(brandRect?.bottom || 0, triggerRect?.bottom || 0)
          - Math.max(brandRect?.top || 0, triggerRect?.top || 0)
        ) * 100) / 100,
        socialTriggerOverlap: Math.round((
          Math.min(socialRect?.bottom || 0, triggerRect?.bottom || 0)
          - Math.max(socialRect?.top || 0, triggerRect?.top || 0)
        ) * 100) / 100,
      };
    });

    expect(collapsedState.panelHeight).toBeLessThanOrEqual(2);
    expect(collapsedState.inert).toBe(true);
    expect(collapsedState.triggerHeight).toBeLessThanOrEqual(90);
    expect(Math.abs(collapsedState.triggerHeight - collapsedState.exploreBtnHeight)).toBeLessThanOrEqual(8);
    expect(collapsedState.triggerWidthRatio).toBeLessThan(0.8);
    expect(collapsedState.triggerCenterOffset).toBeLessThanOrEqual(4);
    expect(collapsedState.triggerCount).toBe(1);
    expect(collapsedState.insideFooter).toBe(true);
    expect(collapsedState.legacyContactSectionCount).toBe(0);
    expect(collapsedState.brandTriggerOverlap).toBeGreaterThanOrEqual(12);
    expect(collapsedState.socialTriggerOverlap).toBeGreaterThanOrEqual(4);

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
    await expect(brand).toBeVisible();
    await expect(socialLink).toBeVisible();

    const openLayout = await page.evaluate(() => {
      const formShellEl = document.querySelector('#contactDrawerPanel .contact-drawer__form-shell');
      const triggerEl = document.getElementById('contactDrawerTrigger');
      const formShellRect = formShellEl?.getBoundingClientRect();
      const triggerRect = triggerEl?.getBoundingClientRect();
      return {
        formShellTopBelowTrigger: Math.round(((formShellRect?.top || 0) - (triggerRect?.bottom || 0)) * 100) / 100,
      };
    });
    expect(openLayout.formShellTopBelowTrigger).toBeGreaterThanOrEqual(-1);

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

  test('footer contact drawer stays collapsed by default on mobile and toggles open cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const rejectAll = page.locator('#ckRejectAll');
    if (await rejectAll.isVisible().catch(() => false)) {
      await rejectAll.click({ force: true });
    }

    const trigger = page.locator('#contactDrawerTrigger');
    const panel = page.locator('#contactDrawerPanel');
    const form = page.locator('#contactForm');
    const panelTitle = page.locator('#contactDrawerPanel .contact-drawer__panel-title');
    const brand = page.locator('.site-footer__brand');
    const socialLink = page.locator('#contact .site-footer__social-link[aria-label="X (Twitter)"]');

    await expect(trigger).toBeVisible();
    await expect(brand).toBeVisible();
    await expect(socialLink).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toContainText('Contact');
    await expect(trigger).not.toContainText('Say Hello');
    await expect(page.getByText('Open the drawer to collaborate, ask a question, or send a note.')).toHaveCount(0);

    const mobileCollapsedState = await page.evaluate(() => {
      const panelEl = document.getElementById('contactDrawerPanel');
      const rowEl = document.querySelector('#contact .site-footer__top');
      const brandEl = document.querySelector('#contact .site-footer__brand');
      const triggerEl = document.getElementById('contactDrawerTrigger');
      const socialEl = document.querySelector('#contact .site-footer__social-link[aria-label="X (Twitter)"]');
      const exploreBtnEl = document.querySelector('#video-creations .video-mode__btn--explore');
      const contactRoot = document.getElementById('contact');
      const rowRect = rowEl?.getBoundingClientRect();
      const brandRect = brandEl?.getBoundingClientRect();
      const triggerRect = triggerEl?.getBoundingClientRect();
      const socialRect = socialEl?.getBoundingClientRect();
      const exploreBtnRect = exploreBtnEl?.getBoundingClientRect();
      const centers = [brandRect, triggerRect, socialRect]
        .filter(Boolean)
        .map((rect) => rect.top + (rect.height / 2));
      const maxCenterSpread = centers.length
        ? Math.max(...centers) - Math.min(...centers)
        : 0;
      return {
        panelHeight: Math.round((panelEl?.getBoundingClientRect().height || 0) * 100) / 100,
        rowHeight: Math.round((rowRect?.height || 0) * 100) / 100,
        triggerHeight: Math.round((triggerRect?.height || 0) * 100) / 100,
        exploreBtnHeight: Math.round((exploreBtnRect?.height || 0) * 100) / 100,
        rowOverflowLeft: Math.round(Math.min(0, rowRect?.left || 0) * 100) / 100,
        rowOverflowRight: Math.round(Math.max(0, (rowRect?.right || 0) - window.innerWidth) * 100) / 100,
        sameRowCenterSpread: Math.round(maxCenterSpread * 100) / 100,
        brandBeforeTrigger: Boolean(brandRect && triggerRect && brandRect.right <= triggerRect.left + 1),
        triggerBeforeSocial: Boolean(triggerRect && socialRect && triggerRect.right <= socialRect.left + 1),
        triggerWidth: Math.round((triggerRect?.width || 0) * 100) / 100,
        triggerCount: document.querySelectorAll('#contactDrawerTrigger').length,
        insideFooter: Boolean(contactRoot?.closest('footer')),
        legacyContactSectionCount: document.querySelectorAll('main > section[aria-label="Contact"]').length,
      };
    });
    expect(mobileCollapsedState.panelHeight).toBeLessThanOrEqual(2);
    expect(mobileCollapsedState.triggerHeight).toBeLessThanOrEqual(84);
    expect(Math.abs(mobileCollapsedState.triggerHeight - mobileCollapsedState.exploreBtnHeight)).toBeLessThanOrEqual(8);
    expect(mobileCollapsedState.rowOverflowLeft).toBe(0);
    expect(mobileCollapsedState.rowOverflowRight).toBe(0);
    expect(mobileCollapsedState.rowHeight).toBeLessThanOrEqual(72);
    expect(mobileCollapsedState.sameRowCenterSpread).toBeLessThanOrEqual(36);
    expect(mobileCollapsedState.brandBeforeTrigger).toBe(true);
    expect(mobileCollapsedState.triggerBeforeSocial).toBe(true);
    expect(mobileCollapsedState.triggerWidth).toBeLessThanOrEqual(140);
    expect(mobileCollapsedState.triggerCount).toBe(1);
    expect(mobileCollapsedState.insideFooter).toBe(true);
    expect(mobileCollapsedState.legacyContactSectionCount).toBe(0);

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panelTitle).toHaveText('Say Hello');
    await expect(panelTitle).toBeVisible();
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="name"]')).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('textarea[name="message"]')).toBeVisible();
    await expect(brand).toBeVisible();
    await expect(socialLink).toBeVisible();
    await expect(panel).toHaveCSS('opacity', '1');

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
        const modeRect = section?.querySelector('.video-mode')?.getBoundingClientRect();
        const contentRect = section?.querySelector('#videoExplore')?.getBoundingClientRect();
        return {
          descriptionsPresent: document.querySelectorAll('#gallery .section__desc, #video-creations .section__desc, #soundlab .section__desc').length,
          modeHintsPresent: document.querySelectorAll('#gallery .gallery-mode__hint, #video-creations .video-mode__hint, #soundlab .video-mode__hint').length,
          modeContentGap: modeRect && contentRect ? contentRect.top - modeRect.bottom : 0,
          sectionPaddingTop: sectionStyle ? parseFloat(sectionStyle.paddingTop) : 0,
          headerMarginBottom: headerStyle ? parseFloat(headerStyle.marginBottom) : 0,
          dividerVisible: Boolean(before && before.content !== 'none' && parseFloat(before.width) > 0.5),
          dividerWidth: before ? parseFloat(before.width) : 0,
          sectionWidth: sectionRect?.width || 0,
        };
      });

      expect(desktopMetrics.descriptionsPresent).toBe(0);
      expect(desktopMetrics.modeHintsPresent).toBe(0);
      expect(desktopMetrics.modeContentGap).toBeGreaterThan(20);
      expect(desktopMetrics.modeContentGap).toBeLessThan(50);
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
        const modeRect = section?.querySelector('.video-mode')?.getBoundingClientRect();
        const contentRect = section?.querySelector('#videoExplore')?.getBoundingClientRect();
        return {
          descriptionsPresent: document.querySelectorAll('#gallery .section__desc, #video-creations .section__desc, #soundlab .section__desc').length,
          modeHintsPresent: document.querySelectorAll('#gallery .gallery-mode__hint, #video-creations .video-mode__hint, #soundlab .video-mode__hint').length,
          modeContentGap: modeRect && contentRect ? contentRect.top - modeRect.bottom : 0,
          sectionPaddingTop: sectionStyle ? parseFloat(sectionStyle.paddingTop) : 0,
          headerMarginBottom: headerStyle ? parseFloat(headerStyle.marginBottom) : 0,
          dividerVisible: Boolean(before && before.content !== 'none' && parseFloat(before.width) > 0.5),
          dividerWidth: before ? parseFloat(before.width) : 0,
          sectionWidth: sectionRect?.width || 0,
        };
      });

      expect(mobileMetrics.descriptionsPresent).toBe(0);
      expect(mobileMetrics.modeHintsPresent).toBe(0);
      expect(mobileMetrics.modeContentGap).toBeLessThan(56);
      expect(mobileMetrics.sectionPaddingTop).toBe(24);
      expect(mobileMetrics.headerMarginBottom).toBe(24);
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
    await expect(page.locator('#galleryExplore .filter-bar')).toHaveCount(0);
    await expect(page.locator('#galleryExplore .filter-btn')).toHaveCount(0);
    await expect(page.locator('#galleryExplore .auth-filter-btn')).toHaveCount(0);
    await expect(page.locator('#galleryExplore .gal-filter-bar')).toHaveCount(0);
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

  test('gallery Explore renders public Mempics directly without category selector pills', async ({ page }) => {
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
              {
                id: 'd4c3b2a1',
                slug: 'mempic-d4c3b2a1',
                title: 'Second Mempic',
                caption: 'Published by Ada Member on 2026-04-13.',
                category: 'mempics',
                publisher: {
                  display_name: 'Ada Member',
                },
                thumb: {
                  url: `/api/gallery/mempics/d4c3b2a1/${mempicVersion}/thumb`,
                  w: 320,
                  h: 320,
                },
                preview: {
                  url: `/api/gallery/mempics/d4c3b2a1/${mempicVersion}/medium`,
                  w: 1280,
                  h: 1280,
                },
                full: {
                  url: `/api/gallery/mempics/d4c3b2a1/${mempicVersion}/file`,
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

    await expect(page.locator('#galleryExplore .filter-btn')).toHaveCount(0);
    await expect(page.locator('#galleryExplore .auth-filter-btn')).toHaveCount(0);
    await expect(page.locator('#galleryExplore .gal-filter-btn')).toHaveCount(0);
    await expect(page.locator('#galleryGrid .locked-area.gallery-item')).toHaveCount(0);
    await expect(page.locator('#galleryGrid')).not.toContainText('Exclusive');

    const mempicsCard = page.locator('#galleryGrid .gallery-item:not(.locked-area):visible').first();
    await expect(mempicsCard).toBeVisible();
    await mempicsCard.hover();
    await expect(mempicsCard.locator('.public-media-meta__title')).toHaveText('Ada Member');
    await expect(mempicsCard.locator('.public-media-meta__avatar')).toBeVisible();
    await expect(mempicsCard.locator('.public-media-meta')).not.toContainText('Mempics');

    await mempicsCard.click();
    await expect(page.locator('#modalTitle')).toHaveText('Mempics');
    await expect(page.locator('#modalCaption')).toHaveText('Published by Ada Member on 2026-04-12.');
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', `/api/gallery/mempics/a1b2c3d4/${mempicVersion}/file`);
    await expect(page.locator('#modalFullLink')).toBeVisible();
    const fullLinkPoint = await page.locator('#modalFullLink').evaluate((link) => {
      const rect = link.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    });
    await page.locator('.modal-close').click();
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);
    await expect(page.locator('#modalFullLink')).toBeHidden();
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', /#$/);
    await expect(page.locator('a[href*="/api/gallery/mempics/"]')).toHaveCount(0);

    const staleLinkState = await page.evaluate(({ x, y }) => {
      const link = document.getElementById('modalFullLink');
      const top = document.elementFromPoint(x, y);
      return {
        linkPointerEvents: window.getComputedStyle(link).pointerEvents,
        topId: top?.id || '',
        topTitle: top?.getAttribute?.('title') || '',
        topHref: top?.getAttribute?.('href') || '',
      };
    }, fullLinkPoint);
    expect(staleLinkState.linkPointerEvents).toBe('none');
    expect(staleLinkState.topId).not.toBe('modalFullLink');
    expect(staleLinkState.topTitle).not.toBe('Open full size');
    expect(staleLinkState.topHref).not.toContain('/api/gallery/mempics/');
    await page.mouse.click(fullLinkPoint.x, fullLinkPoint.y);
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);

    const secondMempicCard = page.locator('#galleryGrid .gallery-item:not(.locked-area):visible').nth(1);
    await secondMempicCard.click();
    await expect(page.locator('#modalTitle')).toHaveText('Second Mempic');
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', `/api/gallery/mempics/d4c3b2a1/${mempicVersion}/file`);
  });

  test('Gallery and Sound Lab cleanup remove stale Exclusive admin references', () => {
    const adminHtml = fs.readFileSync(path.join(process.cwd(), 'admin/index.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(process.cwd(), 'js/pages/admin/main.js'), 'utf8');
    const adminSource = `${adminHtml}\n${adminJs}`;

    expect(adminSource).not.toContain('Little Monster');
    expect(adminSource).not.toContain('Gallery "Exclusive"');
    expect(adminSource).not.toContain('Exclusive (Little Monster)');
    expect(adminSource).not.toContain('Sound Lab Exclusive');
    expect(adminSource).not.toContain('Exclusive audio tracks');
    expect(adminSource).not.toContain('Exclusive track thumbnails');
    expect(adminSource).toContain('Published member tracks');
    expect(adminSource).toContain('Memtracks');
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

  test('desktop published Mempics start at five items and Memvids start at six without changing mobile behavior', async ({ page }) => {
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
    await expect(page.locator('#galleryGrid .gallery-item:visible').first().locator('.public-media-meta__avatar')).toHaveCount(0);

    const galleryToggle = page.locator('#galleryPagination .browse-pagination__toggle');
    await expect(galleryToggle).toHaveAttribute('aria-expanded', 'false');
    await galleryToggle.scrollIntoViewIfNeeded();
    const galleryScrollBefore = await page.evaluate(() => window.scrollY);
    await galleryToggle.click();
    await expect(galleryToggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => page.locator('#galleryGrid .gallery-item:visible').count()).toBe(8);
    const galleryScrollAfter = await page.evaluate(() => window.scrollY);
    expect(galleryScrollAfter).toBeGreaterThanOrEqual(galleryScrollBefore - 1);
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing all 8 Mempics.');
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();

    await switchHomepageCategory(page, 'video');
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing all 6 Memvids');
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();
    await expect.poll(() => page.locator('#videoGrid .video-card:visible').count()).toBe(6);

    const videoToggle = page.locator('#videoPagination .browse-pagination__toggle');
    await expect(videoToggle).toHaveAttribute('aria-expanded', 'false');
    await videoToggle.scrollIntoViewIfNeeded();
    const videoScrollBefore = await page.evaluate(() => window.scrollY);
    await videoToggle.click();
    await expect(videoToggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => page.locator('#videoGrid .video-card:visible').count()).toBe(7);
    const videoScrollAfter = await page.evaluate(() => window.scrollY);
    expect(videoScrollAfter).toBeGreaterThanOrEqual(videoScrollBefore - 1);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing all 7 Memvids.');
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await switchHomepageCategory(page, 'gallery');
    await expect(page.locator('#galleryPagination .browse-pagination__toggle')).toBeHidden();
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toBeEnabled();
    await page.locator('#galleryPagination .browse-pagination__status').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-grid-overlay__item')).toHaveCount(8);
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--gallery')).toBeVisible();
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
    await expect(page.locator('a[href*="/api/gallery/mempics/"]')).toHaveCount(0);
    await page.locator('.mobile-media-grid-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toHaveCount(0);
    await expect(page.locator('a[href*="/api/gallery/mempics/"]')).toHaveCount(0);

    await switchHomepageCategory(page, 'video');
    await expect(page.locator('#videoPagination .browse-pagination__status')).toBeEnabled();
    await page.locator('#videoPagination .browse-pagination__status').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-grid-overlay__item')).toHaveCount(7);
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/memvid-1\/file/);
    await expect(page.locator('#videoModal')).not.toHaveClass(/active/);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await page.locator('.mobile-media-grid-overlay__close').click();

    await switchHomepageCategory(page, 'sound');
    await expect(page.locator('.snd-memtracks-pagination .browse-pagination__status')).toHaveText('Showing all 1 Memtracks.');
    await expect(page.locator('.snd-memtracks-pagination .browse-pagination__status')).toBeEnabled();
    await page.locator('.snd-memtracks-pagination .browse-pagination__status').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-grid-overlay__item')).toHaveCount(1);
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--sound')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay__sound-title')).toHaveText('Public Member Track');
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await page.locator('.mobile-media-grid-overlay__close').click();
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

    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], updated_at: '2026-05-09T00:00:00.000Z' }),
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

  test('mobile Wallet nav action closes the menu, opens wallet workspace, and does not click-through into gallery media', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const popupUrls = [];
    page.on('popup', (popup) => {
      popupUrls.push(popup.url());
      void popup.close().catch(() => {});
    });

    await page.goto('/');

    const walletWorkspace = page.locator('#walletWorkspace');
    await expect(walletWorkspace).toHaveCount(1);
    await expect(walletWorkspace).toBeHidden();

    await page.getByRole('button', { name: 'Toggle menu' }).click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);

    const walletButton = page.locator('#mobileNav').getByRole('button', { name: /Wallet/i }).first();
    await expect(walletButton).toBeVisible();
    await walletButton.click();

    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(walletWorkspace).toBeVisible();
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);
    await expect.poll(() => popupUrls.length).toBe(0);

    await page.locator('[data-wallet-workspace-close="panel"]').click();
    await expect(walletWorkspace).toBeHidden();

    await page.getByRole('button', { name: 'Toggle menu' }).click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page, { homepage: true });
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

  test('homepage Sound Lab renders published member tracks directly without Free or Exclusive categories', async ({ page }) => {
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

    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'feedc0de',
                slug: 'memtrack-feedc0de',
                title: 'Public Member Track',
                caption: 'Published by Ada Member.',
                category: 'memtracks',
                publisher: {
                  display_name: 'Ada Member',
                  avatar: {
                    url: '/api/gallery/memtracks/feedc0de/avpub/avatar',
                  },
                },
                file: { url: '/api/gallery/memtracks/feedc0de/vpub/file' },
                poster: {
                  url: '/api/gallery/memtracks/feedc0de/vpub/poster',
                  w: 320,
                  h: 320,
                },
              },
            ],
            has_more: false,
            next_cursor: null,
            applied_limit: 60,
          },
        }),
      });
    });

    await page.route('**/api/gallery/memtracks/**', async (route) => {
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
          contentType: 'image/webp',
          body: Buffer.from('mock-poster'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: Buffer.from('mock-audio'),
      });
    });

    await page.goto('/');
    await switchHomepageCategory(page, 'sound');

    await expect(page.locator('#soundlab .snd-filter-btn')).toHaveCount(0);
    await expect(page.locator('#soundlab .snd-filter-bar')).toHaveCount(0);
    await expect(page.locator('#soundlab').getByRole('tab', { name: 'Free' })).toHaveCount(0);
    await expect(page.locator('#soundlab').getByRole('tab', { name: /Exclusive/ })).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .snd-card--free')).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .locked-area')).toHaveCount(0);
    for (const retiredTrackName of [
      'Cosmic Sea',
      'Zufall und Notwendigkeit',
      'Relativity',
      'Tiny Hearts',
      'Grok',
      'Burning Slow',
      'Feel It All',
      'The Ones Who Made The Light',
      "Rooms I'll Never Live In",
      'Exclusive',
    ]) {
      await expect(page.locator('#soundLabExplore')).not.toContainText(retiredTrackName);
    }

    const memtrackCard = page.locator('#soundLabTracks .snd-card--memtrack').first();
    await expect(memtrackCard).toBeVisible();
    await expect(memtrackCard.locator('.snd-title')).toHaveText('Public Member Track');
    const identity = memtrackCard.locator('.snd-hero .video-card__info.snd-hero__info .public-media-meta__identity--sound');
    await expect(identity).toBeVisible();
    await expect(identity).toHaveClass(/public-media-meta__identity--video/);
    await expect(memtrackCard.locator('.snd-player-row .public-media-meta__identity--sound')).toHaveCount(0);
    await expect(identity.locator('.public-media-meta__avatar')).toBeVisible();
    await expect(identity.locator('.snd-publisher-name')).toHaveText('Ada Member');
    await expect(identity).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const avatarBox = await identity.locator('.public-media-meta__avatar').boundingBox();
    const nameBox = await identity.locator('.snd-publisher-name').boundingBox();
    expect(avatarBox).not.toBeNull();
    expect(nameBox).not.toBeNull();
    expect(nameBox.x).toBeGreaterThan(avatarBox.x + avatarBox.width - 1);
    await expect(memtrackCard).not.toContainText('.mp3');
    await expect(memtrackCard).not.toContainText('audio/mpeg');
    await expect(memtrackCard.locator('.fav-star')).toBeVisible();
    await expect(memtrackCard.locator('.fav-star')).toHaveCSS('position', 'absolute');
    await expect(memtrackCard.locator('.snd-hero > img')).toHaveAttribute(
      'src',
      '/api/gallery/memtracks/feedc0de/vpub/poster',
    );
    await expect(page.locator('#playlistPlayer')).toBeHidden();

    await memtrackCard.locator('.snd-memtrack-play').click();
    await expect
      .poll(() => page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('bitbi_audio_state_v1') || '{}').trackId || '';
        } catch {
          return '';
        }
      }))
      .toBe('memtrack:feedc0de');
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

  test('English terms page loads and is linked from legal footer', async ({ page }) => {
    const response = await page.goto('/legal/terms.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('.legal-hero__title')).toContainText('Terms of Service');
    await expect(page.locator('main')).toContainText('Effective date: May 5, 2026');
    await expect(page.locator('.site-footer__links a[href="terms.html"]')).toContainText('Terms');
  });

  test('German AGB page loads under the German namespace', async ({ page }) => {
    const response = await page.goto('/de/legal/terms.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('.legal-hero__title')).toContainText('Allgemeine Geschäftsbedingungen');
    await expect(page.locator('main')).toContainText('Stand: 05. Mai 2026');
  });

  test('soft navigation only intercepts parsed http and https allowlist targets', async ({ page }) => {
    await page.goto('/legal/privacy.html');
    await page.evaluate(async () => {
      history.replaceState({ softNav: true }, '', '/legal/privacy.html');
      const { initSoftNav } = await import('/js/shared/soft-nav.js');
      initSoftNav();
    });

    const unsafeResults = await page.evaluate(async () => {
      const { isSoftNavigableHref } = await import('/js/shared/soft-nav.js');
      return [
        'javascript:window.__softNavProbe = "javascript"',
        'data:text/html,unsafe',
        'vbscript:msgbox(1)',
        'http://[::1',
      ].map((href) => ({
        href,
        softNavigable: isSoftNavigableHref(href),
      }));
    });

    expect(unsafeResults.every((entry) => entry.softNavigable === false)).toBe(true);
    await expectPathUnchanged(page, '/legal/privacy.html');
    expect(await page.evaluate(async () => {
      const { isSoftNavigableHref } = await import('/js/shared/soft-nav.js');
      return isSoftNavigableHref('/legal/imprint.html');
    })).toBe(true);

    const allowedPrevented = await page.evaluate(() => {
      window.__softNavFetches = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        window.__softNavFetches.push(String(args[0]));
        return originalFetch(...args);
      };

      const anchor = document.createElement('a');
      anchor.setAttribute('href', '/legal/imprint.html');
      anchor.textContent = 'Imprint';
      document.body.appendChild(anchor);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      const dispatched = anchor.dispatchEvent(event);
      return !dispatched || event.defaultPrevented;
    });

    expect(allowedPrevented).toBe(true);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/legal/imprint.html');
    await expect(page.locator('.legal-hero__title')).toContainText('Imprint');
    const fetches = await page.evaluate(() => window.__softNavFetches);
    expect(fetches.some((url) => new URL(url).pathname === '/legal/imprint.html')).toBe(true);
  });

  test('non-homepage compact heroes remove eyebrow labels while keeping the main hero copy visible', async ({ page }) => {
    for (const pathname of COMPACT_HERO_PATHS) {
      await page.goto(pathname);
      await expect(page.locator('.hero.hero--compact .legal-hero__title')).toBeVisible();
      await expect(page.locator('.hero.hero--compact .legal-hero__desc')).toBeVisible();
      await expect(page.locator('.hero.hero--compact .legal-hero__label, #profileHeroLabel')).toHaveCount(0);
      await expect(page.locator('.hero.hero--compact .hero__content p')).toHaveCount(1);
      const compactHeroMetrics = await page.locator('.hero.hero--compact').evaluate((hero) => {
        const heroStyle = window.getComputedStyle(hero);
        const title = hero.querySelector('.legal-hero__title');
        const titleStyle = title ? window.getComputedStyle(title) : null;
        return {
          paddingTop: parseFloat(heroStyle.paddingTop),
          paddingBottom: parseFloat(heroStyle.paddingBottom),
          titleFontSize: titleStyle ? parseFloat(titleStyle.fontSize) : 0,
        };
      });
      expect(compactHeroMetrics.paddingTop + compactHeroMetrics.paddingBottom).toBeLessThanOrEqual(112);
      expect(compactHeroMetrics.titleFontSize).toBeLessThanOrEqual(50);
    }
  });
});

test.describe('Shared MODELS overlay', () => {
  test('shared subpage desktop header keeps the centered public navigation links without the mood pill', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/legal/imprint.html');

    const nav = page.locator('.site-nav__links');
    const videoLink = nav.getByRole('link', { name: 'Video' });
    await expect(videoLink).toBeVisible();
    await expect(videoLink).toHaveAttribute('href', /\/#video-creations$/);
    await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing.html');
    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Pricing']);
    await expect(nav.getByRole('link', { name: 'Contact' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Models' })).toHaveCount(0);

    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
        };
      };
      const mood = document.querySelector('#navbar .site-nav__mood');
      return {
        viewportWidth: window.innerWidth,
        logo: rect('#navbar .site-nav__logo'),
        video: rect('#navbar [data-category-link="video"]'),
        actions: rect('#navbar .site-nav__actions'),
        moodDisplay: mood ? window.getComputedStyle(mood).display : null,
        moodWidth: mood ? mood.getBoundingClientRect().width : null,
      };
    });

    expect(metrics.video).toBeTruthy();
    expectWithinPx(
      metrics.video.left + (metrics.video.width / 2),
      metrics.viewportWidth / 2,
      'shared subpage video nav center',
      2,
    );
    expectWithinPx(metrics.viewportWidth - metrics.actions.right, metrics.logo.left, 'shared subpage right actions inset', 4);
    expect(metrics.moodDisplay).toBe('none');
    expect(metrics.moodWidth).toBe(0);
    await expect(page.locator('a[aria-label="YouTube"]')).toHaveCount(0);
  });

  test('profile page uses the full shared header navigation instead of the logo-only fallback', async ({ page }) => {
    await page.goto('/account/profile.html');

    const nav = page.locator('.site-nav__links');
    await expect(nav.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing.html');
    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Pricing']);
    await expect(nav.getByRole('link', { name: 'Contact' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Models' })).toHaveCount(0);
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
          .toEqual(['Gallery', 'Video', 'Sound Lab', 'Pricing']);
        await expect(nav.getByRole('link', { name: 'Contact' })).toHaveCount(0);
        await expect(nav.getByRole('button', { name: 'Models' })).toHaveCount(0);
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
    const mobileConnect = page.locator('#mobileNav .mobile-nav__section[aria-label="Connect"]');
    await expect
      .poll(() => mobileExplore.locator(':scope > .mobile-nav__link').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Pricing', 'Models']);
    await expect(mobileConnect.getByRole('link', { name: 'Contact' })).toBeVisible();
  });

  for (const pathname of MODELS_OVERLAY_PATHS) {
    test(`${pathname} opens the local MODELS overlay from the mobile menu without navigation`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(pathname);
      const currentUrl = new URL(page.url());
      const currentPath = `${currentUrl.pathname}${currentUrl.hash}`;

      await page.getByRole('button', { name: 'Toggle menu' }).click();
      const modelsButton = page.locator('#mobileNav').getByRole('button', { name: 'Models' });
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
