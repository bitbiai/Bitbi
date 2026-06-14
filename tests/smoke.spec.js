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
  '/account/profile-settings.html',
  '/account/credits.html',
  '/de/account/credits.html',
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
  '/account/profile-settings.html',
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
  '/account/profile-settings.html',
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
  '/account/profile-settings.html',
  '/account/assets-manager.html',
  '/account/forgot-password.html',
  '/account/reset-password.html',
  '/account/verify-email.html',
];

const FOOTER_COPY_TEXT = 'BITBI Studio • Built with love & code • © 2026';
const REMOVED_FOOTER_FRAGMENT = ['All', 'experiments', 'are', 'mine'].join(' ');
const HOME_SCROLL_RESTORE_KEY = 'bitbi_home_scroll_restore_v2';
const TEST_MP4_BYTES = fs.readFileSync(path.join(__dirname, 'fixtures/media/test-video.mp4'));
const TEST_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=',
  'base64',
);

const expectedModelCatalogs = new Map();
const REMOVED_MODELS_OVERLAY_MODEL_IDS = new Set([
  'bytedance/seedance-2.0',
  'vidu/q3-pro',
]);

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
    [contractModule.ADMIN_AI_VIDEO_SEEDANCE_2_FAST_MODEL_ID, { label: 'Seedance 2.0 Fast' }],
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
      models: (models.video || [])
        .filter((entry) => !REMOVED_MODELS_OVERLAY_MODEL_IDS.has(entry.id))
        .map((entry) => ({
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

async function readHeaderActionOrder(page) {
  return page.locator('#navbar .site-nav__actions').evaluate((actions) => (
    Array.from(actions.children)
      .map((node) => {
        if (node.matches('[data-locale-switcher]')) return 'locale';
        if (node.matches('.wallet-nav__trigger')) return 'panel';
        if (node.matches('.auth-nav__wrap')) return 'auth';
        if (node.matches('.site-nav__mood')) return 'mood';
        if (node.matches('.auth-nav__profile-link')) return 'profile';
        if (node.matches('.auth-nav__admin-link')) return 'admin';
        return node.className || node.tagName.toLowerCase();
      })
      .filter((name) => name !== 'mood')
  ));
}

async function expectGlobalHeaderActionOrder(page) {
  await expect(page.locator('#navbar .locale-switcher')).toBeVisible();
  await expect(page.locator('#navbar .wallet-nav__trigger')).toBeVisible();
  await expect(page.locator('#navbar .auth-nav__wrap')).toBeVisible();

  await expect.poll(() => readHeaderActionOrder(page)).toEqual(expect.arrayContaining(['locale', 'panel', 'auth']));
  const order = await readHeaderActionOrder(page);
  expect(order.indexOf('locale'), `header order ${order.join(' > ')}`).toBeLessThan(order.indexOf('panel'));
  expect(order.indexOf('panel'), `header order ${order.join(' > ')}`).toBeLessThan(order.indexOf('auth'));
}

async function expectAuthContextRemoved(page) {
  await expect(page.locator('#authContextPanel')).toHaveCount(0);
  await expect(page.locator('#authContextBody')).toHaveCount(0);
}

async function markLogoutReloadProbe(page) {
  await page.evaluate(() => {
    window.__bitbiLogoutReloadProbe = 'before-logout';
  });
}

async function expectLogoutHardReload(page) {
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => window.__bitbiLogoutReloadProbe || null);
    } catch {
      return 'navigating';
    }
  }, { timeout: 5000 }).toBeNull();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

async function mockGenerateLabMemberSession(page, {
  email = 'lab@bitbi.ai',
  userId = 'generate-lab-member',
  credits = 900,
} = {}) {
  let logoutRequests = 0;
  let loggedIn = true;

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(loggedIn
        ? {
          loggedIn: true,
          user: { id: userId, email, role: 'user' },
        }
        : { loggedIn: false, user: null }),
    });
  });
  await page.route('**/api/logout', async (route) => {
    logoutRequests += 1;
    loggedIn = false;
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

async function mockGenerateLabSavedImageAssets(page, assets) {
  await page.route('**/api/ai/assets**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          assets,
          next_cursor: null,
          has_more: false,
          applied_limit: Number(new URL(route.request().url()).searchParams.get('limit') || 60),
        },
      }),
    });
  });
  await page.route('**/api/ai/images/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TEST_PNG_BYTES,
    });
  });
}

function buildGenerateLabImageAssets(count = 3) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `asset-ref-${number}`,
      asset_type: 'image',
      title: `Asset Reference ${number}`,
      mime_type: 'image/png',
      size_bytes: TEST_PNG_BYTES.length,
      created_at: '2026-06-05T08:00:00.000Z',
      original_url: `/api/ai/images/asset-ref-${number}/original`,
      medium_url: `/api/ai/images/asset-ref-${number}/medium`,
      thumb_url: `/api/ai/images/asset-ref-${number}/thumb`,
      visibility: 'private',
    };
  });
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

  const normalizedCatalog = actualCatalog.map((group) => ({
    ...group,
    category: {
      BILDGENERIERUNG: 'IMAGE GENERATION',
      MUSIKGENERIERUNG: 'MUSIC GENERATION',
      VIDEOGENERIERUNG: 'VIDEO GENERATION',
    }[group.category] || group.category,
    models: group.models.map((model) => ({
      ...model,
      status: model.status === 'Demnächst' ? 'Coming soon' : model.status,
    })),
  }));

  expect(normalizedCatalog).toEqual(expectedCatalog);

  const renderedCategories = normalizedCatalog.map((group) => group.category);
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

async function waitForLayoutFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
}

async function waitForFixedMediaWallReady(page, gridSelector, itemSelector, expectedTargetWidthMin = 0) {
  await expect.poll(async () => page.evaluate(({ gridSelector, itemSelector, expectedTargetWidthMin }) => {
    const stage = document.getElementById('homeCategories');
    const grid = document.querySelector(gridSelector);
    if (!grid) return 'missing_grid';
    const readStableWidth = () => {
      const viewportWidth = Math.min(
        window.innerWidth || Number.POSITIVE_INFINITY,
        document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
      );
      const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
      const panel = grid.closest('.home-categories__panel');
      const exploreWrapper = grid.closest('#galleryExplore, #videoExplore, #soundLabExplore') || null;
      const sectionInner = grid.closest('.section__inner') || null;
      const panelInner = panel?.querySelector(':scope > .section__inner') || null;
      const candidates = [
        exploreWrapper,
        grid.parentElement,
        sectionInner,
        panel,
        panelInner,
      ].filter(Boolean);
      const widths = [];
      for (const candidate of candidates) {
        const candidateStyle = window.getComputedStyle(candidate);
        const candidateRect = candidate.getBoundingClientRect();
        if (candidateStyle.display !== 'none' && candidateStyle.visibility !== 'hidden' && candidateRect.width > 0) {
          if (finiteViewportWidth > 0 && candidateRect.width > finiteViewportWidth + 1) continue;
          widths.push(candidateRect.width);
        }
      }
      if (widths.length) return Math.min(...widths);
      return 0;
    };
    const style = window.getComputedStyle(grid);
    const targetWidth = Number(grid.dataset.mediaWallResolvedWidth)
      || Number(grid.dataset.publicMediaWallWidthPx)
      || Number.parseFloat(style.getPropertyValue('--bitbi-public-media-wall-resolved-column-width'))
      || 0;
    const baseWidth = Number(grid.dataset.mediaWallBaseWidth)
      || Number.parseFloat(style.getPropertyValue('--bitbi-public-media-wall-base-column-width'))
      || targetWidth;
    const gap = Number(grid.dataset.mediaWallGap)
      || Number.parseFloat(style.columnGap || style.gap)
      || 0;
    const columnCount = Number(grid.dataset.mediaWallColumnCount)
      || Number(grid.dataset.publicMediaWallColumnCount)
      || 0;
    const capacity = Number(grid.dataset.mediaWallCapacity) || columnCount;
    const columns = Array.from(grid.querySelectorAll('.public-media-wall__column'))
      .filter((node) => node.offsetParent !== null)
      .map((node) => node.getBoundingClientRect().width);
    const rects = Array.from(grid.querySelectorAll(itemSelector))
      .filter((node) => node.offsetParent !== null)
      .map((node) => node.getBoundingClientRect());
    const widths = rects.map((rect) => Math.round(rect.width * 100) / 100);
    const columnWidths = columns.map((width) => Math.round(width * 100) / 100);
    const itemWidthsReady = widths.length > 0
      && targetWidth >= expectedTargetWidthMin
      && widths.every((width) => Math.abs(width - targetWidth) <= 2);
    const columnsReady = columnWidths.length > 0
      && columnWidths.every((width) => Math.abs(width - targetWidth) <= 2);
    const storedAvailableWidth = Number(grid.dataset.mediaWallAvailableWidth) || 0;
    const currentAvailableWidth = readStableWidth();
    const expectedCapacity = baseWidth > 0
      ? Math.max(1, Math.floor((currentAvailableWidth + gap) / (baseWidth + gap)))
      : columnCount;
    const expectedColumnCount = rects.length > 0 ? Math.min(rects.length, expectedCapacity) : expectedCapacity;
    const expectedResolvedWidth = expectedColumnCount > 0
      ? Math.max(baseWidth, Math.floor(((currentAvailableWidth - (gap * (expectedColumnCount - 1))) / expectedColumnCount) * 1000) / 1000)
      : baseWidth;
    const ok = (grid.dataset.mediaWallReady === 'true' || grid.dataset.publicMediaWallReady === 'true')
      && !stage?.classList.contains('is-transitioning')
      && currentAvailableWidth > 0
      && Math.abs(storedAvailableWidth - currentAvailableWidth) <= 0.5
      && columnCount > 1
      && capacity === expectedCapacity
      && columnCount === expectedColumnCount
      && targetWidth >= baseWidth
      && Math.abs(targetWidth - expectedResolvedWidth) <= 1
      && itemWidthsReady
      && columnsReady;
    if (ok) return 'ready';
    return JSON.stringify({
      ready: grid.dataset.mediaWallReady || grid.dataset.publicMediaWallReady || '',
      targetWidth,
      baseWidth,
      gap,
      storedAvailableWidth,
      currentAvailableWidth,
      columnCount,
      capacity,
      expectedCapacity,
      expectedColumnCount,
      expectedResolvedWidth,
      widths: widths.slice(0, 5),
      columnWidths: columnWidths.slice(0, 5),
      gridTemplateColumns: style.gridTemplateColumns,
      activeCategory: stage?.dataset.activeCategory || '',
      stageMode: stage?.dataset.stageMode || '',
      transitioning: stage?.classList.contains('is-transitioning') || false,
    });
  }, { gridSelector, itemSelector, expectedTargetWidthMin }), { timeout: 10_000 }).toBe('ready');
  await waitForLayoutFrames(page);
}

async function waitForSoundWidthReady(page, expectedTrackCount = 1) {
  await expect.poll(async () => page.evaluate((expectedTrackCount) => {
    const stage = document.getElementById('homeCategories');
    const grid = document.getElementById('soundLabTracks');
    if (!stage || !grid) return 'missing_sound_grid';
    const readStableWidth = () => {
      const viewportWidth = Math.min(
        window.innerWidth || Number.POSITIVE_INFINITY,
        document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
      );
      const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
      const panel = grid.closest('.home-categories__panel');
      const exploreWrapper = grid.closest('#galleryExplore, #videoExplore, #soundLabExplore') || null;
      const sectionInner = grid.closest('.section__inner') || null;
      const panelInner = panel?.querySelector(':scope > .section__inner') || null;
      const candidates = [
        exploreWrapper,
        grid.parentElement,
        sectionInner,
        panel,
        panelInner,
      ].filter(Boolean);
      const widths = [];
      for (const candidate of candidates) {
        const candidateStyle = window.getComputedStyle(candidate);
        const candidateRect = candidate.getBoundingClientRect();
        if (candidateStyle.display === 'none' || candidateStyle.visibility === 'hidden' || candidateRect.width <= 0) continue;
        if (finiteViewportWidth > 0 && candidateRect.width > finiteViewportWidth + 1) continue;
        widths.push(candidateRect.width);
      }
      return widths.length ? Math.min(...widths) : 0;
    };
    const style = window.getComputedStyle(grid);
    const targetWidth = Number(grid.dataset.soundWallResolvedWidth)
      || Number(grid.dataset.soundCardWidthPx)
      || Number.parseFloat(style.getPropertyValue('--bitbi-public-sound-card-resolved-width'))
      || Number.parseFloat(style.getPropertyValue('--bitbi-public-sound-card-width'))
      || 0;
    const baseWidth = Number(grid.dataset.soundWallBaseWidth)
      || Number.parseFloat(style.getPropertyValue('--bitbi-public-sound-card-width'))
      || targetWidth;
    const gap = Number(grid.dataset.soundWallGap)
      || Number.parseFloat(style.columnGap || style.gap)
      || 0;
    const columnCount = Number(grid.dataset.soundWallColumnCount) || 0;
    const capacity = Number(grid.dataset.soundWallCapacity) || columnCount;
    const rects = Array.from(grid.querySelectorAll('.snd-card--memtrack'))
      .filter((node) => node.offsetParent !== null)
      .map((node) => node.getBoundingClientRect());
    const widths = rects.map((rect) => Math.round(rect.width * 100) / 100);
    const firstTop = rects[0]?.top;
    const firstRowCount = Number.isFinite(firstTop)
      ? rects.filter((rect) => Math.abs(rect.top - firstTop) <= 3).length
      : 0;
    const storedAvailableWidth = Number(grid.dataset.soundWallAvailableWidth) || 0;
    const currentAvailableWidth = readStableWidth();
    const expectedCapacity = baseWidth > 0
      ? Math.max(1, Math.floor((currentAvailableWidth + gap) / (baseWidth + gap)))
      : columnCount;
    const expectedColumnCount = rects.length > 0 ? Math.min(rects.length, expectedCapacity) : expectedCapacity;
    const expectedResolvedWidth = expectedColumnCount > 0
      ? Math.max(baseWidth, Math.floor(((currentAvailableWidth - (gap * (expectedColumnCount - 1))) / expectedColumnCount) * 1000) / 1000)
      : baseWidth;
    const ok = stage.dataset.activeCategory === 'sound'
      && !stage.classList.contains('is-transitioning')
      && (grid.dataset.soundWallReady === 'true' || grid.dataset.soundWidthReady === 'true')
      && currentAvailableWidth > 0
      && Math.abs(storedAvailableWidth - currentAvailableWidth) <= 0.5
      && targetWidth >= baseWidth
      && baseWidth >= 360
      && capacity === expectedCapacity
      && columnCount === expectedColumnCount
      && Math.abs(targetWidth - expectedResolvedWidth) <= 1
      && rects.length >= expectedTrackCount
      && (expectedTrackCount <= 1 || firstRowCount > 1)
      && widths.every((width) => Math.abs(width - targetWidth) <= 2);
    if (ok) return 'ready';
    return JSON.stringify({
      ready: grid.dataset.soundWallReady || grid.dataset.soundWidthReady || '',
      targetWidth,
      baseWidth,
      gap,
      storedAvailableWidth,
      currentAvailableWidth,
      columnCount,
      capacity,
      expectedCapacity,
      expectedColumnCount,
      expectedResolvedWidth,
      widths: widths.slice(0, 5),
      visibleCount: rects.length,
      firstRowCount,
      gridTemplateColumns: style.gridTemplateColumns,
      activeCategory: stage.dataset.activeCategory || '',
      stageMode: stage.dataset.stageMode || '',
      transitioning: stage.classList.contains('is-transitioning'),
    });
  }, expectedTrackCount), { timeout: 10_000 }).toBe('ready');
  await waitForLayoutFrames(page);
}

async function routeDefaultMemtracks(page, {
  id = 'feedc0de',
  version = 'vpub',
  title = 'Public Member Track',
  modelLabel = 'Music 2.6',
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
              model_label: modelLabel,
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

async function routeHomepageVideoHoverFixtures(page, { items, videoRequests = [], homepageHeroVideos = null }) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ loggedIn: false, user: null }),
    });
  });

  await page.route('**/api/public/news-pulse**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], updated_at: '2026-05-09T00:00:00.000Z' }),
    });
  });

  await page.route('https://videodelivery.net/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith('/downloads/default.mp4')) {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: TEST_MP4_BYTES,
      });
      return;
    }
    if (requestUrl.pathname.endsWith('/manifest/video.m3u8')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: '#EXTM3U\n#EXT-X-ENDLIST\n',
      });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });

  await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { items: [], has_more: false, next_cursor: null } }),
    });
  });

  await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { items: [], has_more: false, next_cursor: null } }),
    });
  });

  await page.route(/\/api\/homepage\/hero-videos$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(homepageHeroVideos || {
        ok: true,
        data: {
          configured: false,
          slots: [],
          slot_order: ['right_top', 'right_bottom', 'left_top', 'left_bottom'],
        },
      }),
    });
  });

  await page.route('**/api/homepage/hero-videos/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith('/poster')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/webp',
        body: Buffer.from('mock-hero-poster'),
      });
      return;
    }
    if (requestUrl.pathname.endsWith('/file')) {
      videoRequests.push(requestUrl.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-hero-video'),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'not_found' }),
    });
  });

  await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          items,
          has_more: false,
          next_cursor: null,
        },
      }),
    });
  });

  await page.route('**/api/gallery/memvids/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith('/poster') || requestUrl.pathname.endsWith('/avatar')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
      return;
    }

    if (requestUrl.pathname.endsWith('/file')) {
      videoRequests.push(requestUrl.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'not_found' }),
    });
  });

  await page.route('https://videodelivery.net/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.apple.mpegurl',
      body: '#EXTM3U\n#EXT-X-ENDLIST\n',
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

async function readHomepageResponsiveStageState(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('homeCategories');
    const panels = ['gallery', 'video', 'sound'].map((category) => {
      const selector = category === 'video' ? '#video-creations' : category === 'sound' ? '#soundlab' : '#gallery';
      const panel = document.querySelector(selector);
      const style = panel ? window.getComputedStyle(panel) : null;
      const rect = panel?.getBoundingClientRect();
      return {
        category,
        id: panel?.id || '',
        ariaHidden: panel?.getAttribute('aria-hidden') || '',
        inert: Boolean(panel?.inert),
        display: style?.display || '',
        position: style?.position || '',
        pointerEvents: style?.pointerEvents || '',
        transientClasses: panel
          ? Array.from(panel.classList).filter((className) => (
            className.startsWith('is-transition')
              || className.startsWith('is-leave')
              || className.startsWith('is-enter')
              || className === 'is-layout-preparing'
              || className === 'is-webkit-preparing'
          ))
          : [],
        visible: Boolean(rect && rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden'),
      };
    });
    const mobileMenu = document.getElementById('mobileMenuBtn');
    const desktopLinks = document.querySelector('#navbar .site-nav__links');
    return {
      activeCategory: stage?.dataset.activeCategory || '',
      stageMode: stage?.dataset.stageMode || '',
      motionEngine: stage?.dataset.motionEngine || '',
      ready: stage?.classList.contains('is-ready') || false,
      bodyStageClass: document.body.classList.contains('home-categories-desktop-stage'),
      transitioning: stage?.classList.contains('is-transitioning') || false,
      webKitSwitching: stage?.classList.contains('is-webkit-switching') || false,
      webKitRevealing: stage?.classList.contains('is-webkit-revealing') || false,
      viewportHeightStyle: stage?.querySelector('.home-categories__viewport')?.style.height || '',
      viewportMinHeightStyle: stage?.querySelector('.home-categories__viewport')?.style.minHeight || '',
      overflowX: Math.max(
        0,
        document.documentElement.scrollWidth - window.innerWidth,
        document.body.scrollWidth - window.innerWidth,
      ),
      media: {
        desktopHover: window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches,
        tabletDesktopLayout: window.matchMedia('(min-width: 768px) and (max-width: 1023px) and (min-height: 700px), (min-width: 1024px) and (hover: none) and (pointer: coarse) and (min-height: 700px)').matches,
        stagedLayout: window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine), (min-width: 768px) and (max-width: 1023px) and (min-height: 700px), (min-width: 1024px) and (hover: none) and (pointer: coarse) and (min-height: 700px)').matches,
        hoverPreview: window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches,
      },
      mobileMenuVisible: mobileMenu ? window.getComputedStyle(mobileMenu).display !== 'none' : false,
      desktopLinksVisible: desktopLinks ? window.getComputedStyle(desktopLinks).display !== 'none' : false,
      panels,
    };
  });
}

function expectSingleInteractiveHomepagePanel(state, expectedCategory) {
  expect(state.activeCategory).toBe(expectedCategory);
  for (const panel of state.panels) {
    const isActive = panel.category === expectedCategory;
    expect(panel.ariaHidden, `${panel.category} aria-hidden`).toBe(isActive ? 'false' : 'true');
    expect(panel.inert, `${panel.category} inert`).toBe(!isActive);
    expect(panel.visible, `${panel.category} visible`).toBe(isActive);
    expect(panel.pointerEvents, `${panel.category} pointer-events`).toBe(isActive ? 'auto' : 'none');
  }
}

async function readHomepageCategoryAnchorMetrics(page, category) {
  return page.evaluate((targetCategory) => {
    const panelSelector = {
      gallery: '#gallery',
      video: '#video-creations',
      sound: '#soundlab',
    }[targetCategory];
    const panel = panelSelector ? document.querySelector(panelSelector) : null;
    const stage = document.getElementById('homeCategories');
    const navbar = document.getElementById('navbar');
    const header = panel?.querySelector('.section__header--sm') || panel?.querySelector('.section__title')?.closest('.section__header--sm');
    const controls = panel?.querySelector('.gallery-mode, .video-mode, .sound-mode');
    const content = panel?.querySelector('#galleryExplore, #videoExplore, #soundLabExplore');
    const navRect = navbar?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const controlsRect = controls?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();

    return {
      motionEngine: stage?.dataset.motionEngine || '',
      transitioning: stage?.classList.contains('is-transitioning') || false,
      activeCategory: stage?.dataset.activeCategory || '',
      navBottom: navRect ? Math.round(navRect.bottom * 100) / 100 : 0,
      stageTop: stage ? Math.round(stage.getBoundingClientRect().top * 100) / 100 : 0,
      headerTop: headerRect ? Math.round(headerRect.top * 100) / 100 : 0,
      headerBottom: headerRect ? Math.round(headerRect.bottom * 100) / 100 : 0,
      controlsTop: controlsRect ? Math.round(controlsRect.top * 100) / 100 : 0,
      controlsBottom: controlsRect ? Math.round(controlsRect.bottom * 100) / 100 : 0,
      contentTop: contentRect ? Math.round(contentRect.top * 100) / 100 : 0,
      viewportHeight: window.innerHeight,
    };
  }, category);
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

  test('homepage KI-PULS renders as a centered hero news box with indicator navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const requestedLocales = [];
    await page.route('**/api/public/news-pulse**', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname.includes('/thumbs/')) {
        await route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('mock-thumb') });
        return;
      }
      requestedLocales.push(requestUrl.searchParams.get('locale'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: buildNewsPulseItems('disabled-pulse'), updated_at: '2026-05-09T08:00:00.000Z' }),
      });
    });

    for (const path of ['/', '/de/']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const pulse = page.locator('#newsPulse');
      await expect(page.locator('#hero > #newsPulse')).toHaveCount(1);
      await expect(pulse).not.toHaveAttribute('data-news-pulse-disabled', /.+/);
      await expect(pulse).not.toHaveAttribute('hidden', '');
      await expect(pulse.locator('.news-pulse__slide')).toHaveCount(3);
      await expect(pulse.locator('.news-pulse__indicator-button')).toHaveCount(3);
      await expect(pulse.locator('.news-pulse__indicator-button.is-active')).toHaveAttribute('aria-current', 'true');
      await expect
        .poll(() => pulse.evaluate((node) => node.dataset.newsPulseHeroPlacement || ''), { timeout: 10_000 })
        .toBe('ready');
      const state = await pulse.evaluate((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const heroElement = document.querySelector('#hero');
        const hero = heroElement.getBoundingClientRect();
        const labels = [...document.querySelectorAll('#hero .latest-models-video-module__label')]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            const computed = window.getComputedStyle(element);
            return box.width > 0 && box.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden';
          })
          .map((element) => element.getBoundingClientRect());
        const scrollHint = document.querySelector('#hero .hero__scroll-hint');
        const scrollHintRect = scrollHint.getBoundingClientRect();
        const scrollHintStyle = window.getComputedStyle(scrollHint);
        const scrollBottom = Number.parseFloat(scrollHintStyle.insetBlockEnd || scrollHintStyle.bottom || '0') || 0;
        const stableScrollTop = hero.bottom - scrollBottom - scrollHintRect.height;
        const activeLink = node.querySelector('.news-pulse__slide.is-active a');
        const activeThumb = node.querySelector('.news-pulse__slide.is-active .news-pulse__thumb');
        const activeThumbRect = activeThumb?.getBoundingClientRect();
        const firstIndicator = node.querySelector('.news-pulse__indicator-button');
        const labelNode = node.querySelector('.news-pulse__label');
        const labelRect = labelNode?.getBoundingClientRect();
        const labelStyle = labelNode ? getComputedStyle(labelNode) : null;
        return {
          display: style.display,
          visibility: style.visibility,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          childCount: node.children.length,
          text: node.textContent.trim(),
          centerX: rect.left + rect.width / 2,
          heroCenterX: hero.left + hero.width / 2,
          heroTop: hero.top,
          labelBottom: Math.max(...labels.map((label) => label.bottom)),
          scrollTop: stableScrollTop,
          storedScrollTop: Number.parseFloat(node.dataset.newsPulseHeroScrollTop || 'NaN') + hero.top,
          placementBoundary: node.dataset.newsPulseHeroBoundary || '',
          activeText: node.querySelector('.news-pulse__slide.is-active .news-pulse__title')?.textContent.trim() || '',
          activeThumbWidth: activeThumbRect?.width || 0,
          activeThumbHeight: activeThumbRect?.height || 0,
          activeLinkTarget: activeLink?.target || '',
          activeLinkRel: activeLink?.rel || '',
          firstIndicatorLabel: firstIndicator?.getAttribute('aria-label') || '',
          labelText: labelNode?.textContent.trim() || '',
          labelPosition: labelStyle?.position || '',
          labelClipPath: labelStyle?.clipPath || '',
          labelWidth: labelRect?.width || 0,
          labelHeight: labelRect?.height || 0,
        };
      });
      expect(state.display).not.toBe('none');
      expect(state.visibility).toBe('visible');
      expect(state.width).toBeGreaterThan(420);
      expect(state.height).toBeGreaterThan(80);
      expect(state.childCount).toBeGreaterThan(0);
      expect(state.labelText).toBe(path === '/de/' ? 'KI-Puls' : 'Bitbi Live Pulse');
      expect(state.labelPosition).toBe('absolute');
      expect(state.labelClipPath).toContain('inset');
      expect(state.labelWidth).toBeLessThanOrEqual(1);
      expect(state.labelHeight).toBeLessThanOrEqual(1);
      expect(state.activeText).toContain('disabled-pulse headline 1');
      expect(state.activeThumbWidth).toBeGreaterThanOrEqual(62);
      expect(state.activeThumbHeight).toBeGreaterThanOrEqual(62);
      expectWithinPx(state.centerX, state.heroCenterX, `${path} desktop News Pulse horizontal center`, 2);
      expect(state.placementBoundary).toBe('stable-scroll-hint');
      expectWithinPx(state.storedScrollTop, state.scrollTop, `${path} desktop News Pulse stored scroll boundary`, 1);
      const gapAbove = state.top - state.labelBottom;
      const gapBelow = state.scrollTop - state.bottom;
      expect(gapAbove).toBeGreaterThan(8);
      expect(gapBelow).toBeGreaterThan(8);
      const centeredTop = state.labelBottom + ((state.scrollTop - state.labelBottom - state.height) / 2);
      const expectedLowerTop = state.heroTop + ((centeredTop - state.heroTop) * 1.1);
      expectWithinPx(state.top, expectedLowerTop, `${path} desktop News Pulse 10% lower position`, 3);
      await page.waitForTimeout(650);
      const stableRect = await pulse.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      });
      expectWithinPx(stableRect.top, state.top, `${path} desktop News Pulse ignores scroll bounce top`, 2);
      expectWithinPx(stableRect.height, state.height, `${path} desktop News Pulse ignores scroll bounce height`, 2);
      expect(state.activeLinkTarget).toBe('_blank');
      expect(state.activeLinkRel).toContain('noopener');
      expect(state.activeLinkRel).toContain('noreferrer');
      expect(state.firstIndicatorLabel).toMatch(path === '/de/' ? /Nachricht 1 von 3 anzeigen/ : /Show news item 1 of 3/);

      await pulse.locator('.news-pulse__indicator-button').nth(1).click();
      await expect(pulse.locator('.news-pulse__slide.is-active .news-pulse__title')).toContainText('disabled-pulse headline 2');
      await expect(pulse.locator('.news-pulse__indicator-button').nth(1)).toHaveAttribute('aria-current', 'true');
    }
    expect(requestedLocales).toEqual(['en', 'de']);
  });

  test('homepage Live Pulse does not render duplicate visible news items', async ({ page }) => {
    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'pulse-duplicate-a',
              title: 'Duplicate AI headline',
              summary: 'First duplicate summary.',
              source: 'Bitbi Test Source',
              url: 'https://example.com/duplicate-ai-headline',
              category: 'AI',
            },
            {
              id: 'pulse-duplicate-b',
              title: 'Duplicate AI headline',
              summary: 'Second duplicate summary.',
              source: 'Bitbi Test Source',
              url: 'https://example.com/duplicate-ai-headline',
              category: 'AI',
            },
            {
              id: 'pulse-unique',
              title: 'Unique AI headline',
              summary: 'Unique source-attributed summary.',
              source: 'Bitbi Test Source',
              url: 'https://example.com/unique-ai-headline',
              category: 'AI',
            },
          ],
          updated_at: '2026-05-09T08:00:00.000Z',
        }),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const titles = await page.locator('#newsPulse .news-pulse__slide .news-pulse__title').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent.trim()).filter(Boolean)
    );
    expect(titles).toEqual(['Duplicate AI headline', 'Unique AI headline']);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('German homepage Live Pulse requests the German endpoint and keeps the localized label non-visual', async ({ page }) => {
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
    await expect(pulse.locator('.news-pulse__slides')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__slide')).toHaveCount(1);
    await expect(pulse.locator('.news-pulse__indicator-button')).toHaveCount(1);
    const labelState = await pulse.locator('.news-pulse__label').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        text: node.textContent.trim(),
        position: style.position,
        clipPath: style.clipPath,
        width: rect.width,
        height: rect.height,
      };
    });
    expect(labelState.text).toBe('KI-Puls');
    expect(labelState.position).toBe('absolute');
    expect(labelState.clipPath).toContain('inset');
    expect(labelState.width).toBeLessThanOrEqual(1);
    expect(labelState.height).toBeLessThanOrEqual(1);
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
    expectWithinPx((pulseLayout.left + pulseLayout.right) / 2, pulseLayout.heroLeft + pulseLayout.heroWidth / 2, 'German pulse center', 2);
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
      const labelState = await pulse.locator('.news-pulse__label').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          text: node.textContent.trim(),
          position: style.position,
          clipPath: style.clipPath,
          width: rect.width,
          height: rect.height,
        };
      });
      expect(labelState.text).toBe(label);
      expect(labelState.position).toBe('absolute');
      expect(labelState.clipPath).toContain('inset');
      expect(labelState.width).toBeLessThanOrEqual(1);
      expect(labelState.height).toBeLessThanOrEqual(1);
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
        const rangeTop = header.bottom + (distance * 0.055);
        const rangeBottom = header.bottom + (distance * 0.955);
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const expectedHeight = Math.min(
          Math.max(5.25 * rootFontSize, window.innerHeight * 0.11),
          6.25 * rootFontSize,
          Math.max(0, rangeBottom - rangeTop),
        );
        const center = rangeTop + ((rangeBottom - rangeTop) / 2);
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          expectedTop: center - (expectedHeight / 2),
          expectedBottom: center + (expectedHeight / 2),
          expectedHeight,
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
      expectWithinPx(layout.height, layout.expectedHeight, `${locale} mobile pulse compact height`, 4);
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
    expect(durationSeconds).toBeGreaterThanOrEqual(1.68);
    expect(durationSeconds).toBeLessThanOrEqual(1.72);
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

    await markLogoutReloadProbe(page);
    await page.evaluate(async () => {
      const { authLogout } = await import('/js/shared/auth-state.js');
      await authLogout();
    });
    await expectLogoutHardReload(page);
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
    await waitForHomepageScrollableRange(page, 760);

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
    for (const { path, labels, removedPricingLabel } of [
      { path: '/', labels: ['Gallery', 'Video', 'Sound Lab'], removedPricingLabel: 'Pricing' },
      { path: '/de/', labels: ['Galerie', 'Video', 'Sound Lab'], removedPricingLabel: 'Preise' },
    ]) {
      await page.goto(path);
      const nav = page.locator('#navbar .site-nav__links');

      await expect(nav.getByRole('link', { name: labels[0] })).toBeVisible();
      await expect(nav.getByRole('link', { name: labels[1] })).toBeVisible();
      await expect(nav.getByRole('link', { name: labels[2] })).toBeVisible();
      await expect(nav.getByRole('link', { name: removedPricingLabel })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Contact' })).toHaveCount(0);
      await expect(nav.getByRole('button', { name: 'Models' })).toHaveCount(0);
      await expect(page.locator('#hero > #newsPulse')).toHaveCount(1);
      await expectGlobalHeaderActionOrder(page);
      await expect(page.locator('#navbar .wallet-nav__trigger')).toHaveAttribute('aria-controls', 'walletModal');

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
        const pulse = document.querySelector('#hero > #newsPulse');
        const pulseStyle = pulse ? window.getComputedStyle(pulse) : null;
        return {
          viewportWidth: window.innerWidth,
          logo: rect('#navbar .site-nav__logo'),
          pulse: rect('#hero > #newsPulse'),
          pulseDisplay: pulseStyle?.display || null,
          pulseHidden: pulse?.hasAttribute('hidden') || false,
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
      expect(metrics.pulseHidden).toBe(false);
      expect(metrics.pulseDisplay).not.toBe('none');
      expect(metrics.pulse.width).toBeGreaterThan(320);
      expect(metrics.gallery.left).toBeGreaterThan(metrics.logo.right + 8);
      expect(metrics.gallery.right).toBeLessThan(metrics.video.left);
      expect(metrics.sound.left).toBeGreaterThan(metrics.video.right);
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

  test('shared public and member headers place the language selector before Panel and Sign In', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    for (const { path, signInLabel, localeHref } of [
      { path: '/', signInLabel: 'Sign In', localeHref: '/de/' },
      { path: '/pricing.html', signInLabel: 'Sign In', localeHref: '/de/pricing.html' },
      { path: '/account/profile.html', signInLabel: 'Sign In', localeHref: '/de/account/profile' },
      { path: '/de/', signInLabel: 'Anmelden', localeHref: '/' },
      { path: '/de/pricing.html', signInLabel: 'Anmelden', localeHref: '/pricing.html' },
      { path: '/de/account/profile.html', signInLabel: 'Anmelden', localeHref: '/account/profile' },
    ]) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expectGlobalHeaderActionOrder(page);
      await expect(page.locator('#navbar .site-nav__cta')).toHaveText(signInLabel);
      await expect(page.locator(`#navbar .locale-switcher__link[href="${localeHref}"]`)).toBeVisible();
      await expect(page.locator('#navbar .wallet-nav__trigger')).toHaveAttribute('aria-label', 'Open wallet panel');
    }
  });

  test('mobile homepage menu keeps Panel and sign-in while account creation sits below the header', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.goto('/');
    await expect(page.locator('#navbar .locale-switcher')).toBeAttached();
    await expect(page.locator('#navbar .wallet-nav__trigger')).toBeHidden();
    await expect(page.locator('#mobileHeaderCreateAccount')).toBeVisible();
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveText('Join for free');
    await expect(page.getByText('CREATE *FREE* ACCOUNT')).toHaveCount(0);

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await expect(page.locator('#mobileNav .mobile-nav__section--wallet [data-wallet-open="mobile"]')).toBeVisible();
    await expect(page.locator('#mobileNav').getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.locator('#mobileNav .auth-nav__mobile-continuity')).toHaveCount(0);
    await expect(page.locator('#mobileNav .auth-nav__mobile-workspace')).toHaveCount(0);
    await expect(page.locator('#mobileNav')).not.toContainText('Account workspace needs sign-in');
    await expect(page.locator('#mobileNav')).not.toContainText('Create Account');
    await expect(page.locator('#mobileNav')).not.toContainText('Reset password');
  });

  test('global content shells align to the homepage header inset without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    for (const { path, selector } of [
      { path: '/pricing.html', selector: '.pricing-root' },
      { path: '/generate-lab/', selector: '.generate-lab__desktop' },
      { path: '/account/profile.html', selector: '.profile-shell' },
      { path: '/account/credits.html', selector: '.credits-shell' },
      { path: '/account/assets-manager.html', selector: '.assets-manager-shell' },
    ]) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(selector)).toBeVisible({ timeout: 10_000 });
      const layout = await page.evaluate((shellSelector) => {
        const shell = document.querySelector(shellSelector)?.getBoundingClientRect();
        const logo = document.querySelector('#navbar .site-nav__logo')?.getBoundingClientRect();
        return {
          shellLeft: shell?.left ?? 0,
          shellRight: shell?.right ?? 0,
          logoLeft: logo?.left ?? 0,
          viewportWidth: window.innerWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      }, selector);
      expectWithinPx(layout.shellLeft, layout.logoLeft, `${path} content shell left`, 4);
      expectWithinPx(layout.viewportWidth - layout.shellRight, layout.logoLeft, `${path} content shell right`, 4);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
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
    const expectSettledHomepageCategory = async (category) => {
      await expectActiveHomepageCategory(page, category);
      await waitForHomepageCategoryStage(page);
      await expect.poll(async () => {
        const state = await readHomepageResponsiveStageState(page);
        return `${state.viewportHeightStyle}|${state.viewportMinHeightStyle}`;
      }, { timeout: 10_000 }).toBe('|');
      const state = await readHomepageResponsiveStageState(page);
      expectSingleInteractiveHomepagePanel(state, category);
      expect(state.transitioning).toBe(false);
      expect(state.viewportHeightStyle).toBe('');
      expect(state.viewportMinHeightStyle).toBe('');
      const readySelector = category === 'gallery'
        ? '#galleryGrid'
        : category === 'video'
          ? '#videoGrid'
          : '#soundLabTracks';
      await expect.poll(async () => page.evaluate(({ selector, category }) => {
        const grid = document.querySelector(selector);
        if (!grid) return 'missing';
        if (category === 'sound') return grid.dataset.soundWallReady || grid.dataset.soundWidthReady || '';
        return grid.dataset.mediaWallReady || grid.dataset.publicMediaWallReady || '';
      }, { selector: readySelector, category }), { timeout: 10_000 }).toBe('true');
    };

    await expect(stage).toHaveAttribute('data-stage-mode', 'desktop');
    await expectActiveHomepageCategory(page, 'video');
    await waitForHomepageCategoryStage(page);
    let settledState = await readHomepageResponsiveStageState(page);
    expect(settledState.motionEngine).toBe('standard');
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
    await expectSettledHomepageCategory('gallery');
    settledState = await readHomepageResponsiveStageState(page);
    expect(settledState.motionEngine).toBe('standard');
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'gallery');
    await expect(page.locator('#galleryGrid .gallery-item').filter({ hasText: 'Staged Gallery Card' })).toBeVisible();

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
    await expectSettledHomepageCategory('video');
    await waitForHomepageCategoryAlignment(page);
    await expectHomepageHeaderCategoryGlow(page, 'video');

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Sound Lab' }).click();
    await expectSettledHomepageCategory('sound');
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
    await expectSettledHomepageCategory('gallery');
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

  test('homepage WebKit safe switch settles without heavy carousel state', async ({ page }) => {
    test.setTimeout(45_000);

    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'vendor', {
        configurable: true,
        get: () => 'Apple Computer, Inc.',
      });
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      });
    });

    await page.goto('/');
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-stage-mode', 'desktop');
    await waitForHomepageCategoryStage(page);

    let state = await readHomepageResponsiveStageState(page);
    expect(state.motionEngine).toBe('webkit-safe');

    for (const category of ['gallery', 'video', 'sound']) {
      await page.locator('#navbar .site-nav__links').getByRole('link', {
        name: category === 'gallery' ? 'Gallery' : category === 'video' ? 'Video' : 'Sound Lab',
      }).click();
      await expectActiveHomepageCategory(page, category);
      await waitForHomepageCategoryStage(page);
      await expect.poll(async () => {
        const state = await readHomepageResponsiveStageState(page);
        const metrics = await readHomepageCategoryAnchorMetrics(page, category);
        const stageAligned = Math.abs(metrics.stageTop - metrics.navBottom) <= 2;
        const headerVisible = metrics.headerTop >= metrics.navBottom - 2
          && metrics.headerTop < metrics.viewportHeight - 96;
        const controlsVisible = metrics.controlsBottom > metrics.navBottom + 16
          && metrics.controlsBottom < metrics.viewportHeight;
        const contentBelowControls = metrics.contentTop > metrics.controlsBottom + 8;
        const mediaNotPinnedUnderNav = metrics.contentTop > metrics.navBottom + 96;
        const noTransientPanelClasses = state.panels.every((panel) => panel.transientClasses.length === 0);
        return [
          metrics.motionEngine,
          metrics.activeCategory,
          String(metrics.transitioning),
          String(state.webKitSwitching),
          String(state.webKitRevealing),
          `${state.viewportHeightStyle}|${state.viewportMinHeightStyle}`,
          String(stageAligned),
          String(headerVisible),
          String(controlsVisible),
          String(contentBelowControls),
          String(mediaNotPinnedUnderNav),
          String(noTransientPanelClasses),
        ].join('|');
      }, { timeout: 10_000 }).toBe(`webkit-safe|${category}|false|false|false|||true|true|true|true|true|true`);
      state = await readHomepageResponsiveStageState(page);
      expectSingleInteractiveHomepagePanel(state, category);
    }

    await page.evaluate(() => {
      const links = [
        document.querySelector('#navbar .site-nav__links [data-category-link="gallery"]'),
        document.querySelector('#navbar .site-nav__links [data-category-link="video"]'),
        document.querySelector('#navbar .site-nav__links [data-category-link="sound"]'),
      ].filter(Boolean);
      links.forEach((link) => link.click());
    });
    await expectActiveHomepageCategory(page, 'sound');
    await expect.poll(async () => {
      const state = await readHomepageResponsiveStageState(page);
      return [
        state.motionEngine,
        state.activeCategory,
        String(state.transitioning),
        String(state.webKitSwitching),
        String(state.webKitRevealing),
        `${state.viewportHeightStyle}|${state.viewportMinHeightStyle}`,
        String(state.panels.every((panel) => panel.transientClasses.length === 0)),
      ].join('|');
    }, { timeout: 10_000 }).toBe('webkit-safe|sound|false|false|false|||true');
    state = await readHomepageResponsiveStageState(page);
    expectSingleInteractiveHomepagePanel(state, 'sound');
  });

  test('mobile homepage categories remain stacked in document flow with no desktop carousel controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const stage = page.locator('#homeCategories');
    await expect(stage).toHaveAttribute('data-stage-mode', 'stacked');
    await expect(stage).not.toHaveClass(/is-ready/);
    await expect(stage.locator('[data-category-nav]')).toHaveCount(0);
    await expect(page.locator('#mobileMenuBtn')).toBeVisible();

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

    const overflowX = await page.evaluate(() => Math.max(
      0,
      document.documentElement.scrollWidth - window.innerWidth,
      document.body.scrollWidth - window.innerWidth,
    ));
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test('phone landscape does not activate tablet desktop layout', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');

    const state = await readHomepageResponsiveStageState(page);
    expect(state.media.stagedLayout).toBe(false);
    expect(state.stageMode).toBe('stacked');
    expect(state.ready).toBe(false);
    expect(state.bodyStageClass).toBe(false);
    expect(state.overflowX).toBeLessThanOrEqual(1);
    expect(state.panels.every((panel) => panel.display !== 'none')).toBe(true);
    expect(state.panels.every((panel) => panel.position !== 'absolute')).toBe(true);
  });

  test('tablet desktop layout stages homepage categories without desktop hover media', async ({ browser }) => {
    const contexts = [
      {
        label: '768 portrait',
        options: { viewport: { width: 768, height: 1024 } },
        useMobileMenu: true,
        expectedColumns: 3,
      },
      {
        label: '820 portrait',
        options: { viewport: { width: 820, height: 1180 } },
        useMobileMenu: true,
        expectedColumns: 3,
      },
      {
        label: '1024 touch portrait',
        options: { viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true },
        useMobileMenu: false,
        expectedColumns: 4,
      },
    ];

    for (const { label, options, useMobileMenu, expectedColumns } of contexts) {
      const context = await browser.newContext(options);
      const tabletPage = await context.newPage();

      try {
        await tabletPage.goto('/');

        await expect(tabletPage.locator('#homeCategories')).toHaveAttribute('data-stage-mode', 'desktop');
        await waitForHomepageCategoryStage(tabletPage);
        let state = await readHomepageResponsiveStageState(tabletPage);
        expect(state.media.stagedLayout, label).toBe(true);
        expect(state.media.tabletDesktopLayout, label).toBe(true);
        expect(state.media.desktopHover, label).toBe(false);
        expect(state.media.hoverPreview, label).toBe(false);
        expect(state.ready, label).toBe(true);
        expect(state.bodyStageClass, label).toBe(true);
        expect(state.overflowX, label).toBeLessThanOrEqual(2);
        expectSingleInteractiveHomepagePanel(state, 'video');

        const categoryLinkRoot = useMobileMenu
          ? tabletPage.locator('#mobileNav')
          : tabletPage.locator('#navbar .site-nav__links');

        if (useMobileMenu) {
          await expect(tabletPage.locator('#mobileMenuBtn')).toBeVisible();
          await tabletPage.locator('#mobileMenuBtn').click();
          await expect(categoryLinkRoot).toHaveClass(/open/);
        } else {
          await expect(tabletPage.locator('#navbar .site-nav__links')).toBeVisible();
        }

        await categoryLinkRoot.getByRole('link', { name: 'Gallery' }).click();
        await expectActiveHomepageCategory(tabletPage, 'gallery');
        await waitForHomepageCategoryStage(tabletPage);
        state = await readHomepageResponsiveStageState(tabletPage);
        expect(state.overflowX, `${label} gallery overflow`).toBeLessThanOrEqual(2);
        expectSingleInteractiveHomepagePanel(state, 'gallery');
        const galleryColumns = await tabletPage.evaluate(() => {
          const grid = document.querySelector('#galleryGrid');
          const style = grid ? window.getComputedStyle(grid) : null;
          const rect = grid?.getBoundingClientRect();
          const gap = Number.parseFloat(style?.columnGap || '') || 8;
          const columnWidth = Number.parseFloat(style?.columnWidth || '') || 212;
          return rect?.width
            ? Math.max(1, Math.floor((rect.width + gap) / (columnWidth + gap)))
            : 0;
        });
        expect(galleryColumns, `${label} gallery columns`).toBe(expectedColumns);

        if (useMobileMenu) {
          await expect(tabletPage.locator('#mobileMenuBtn')).toBeVisible();
          await tabletPage.locator('#mobileMenuBtn').click();
        }
        await categoryLinkRoot.getByRole('link', { name: 'Video' }).click();
        await expectActiveHomepageCategory(tabletPage, 'video');
        await waitForHomepageCategoryStage(tabletPage);
        state = await readHomepageResponsiveStageState(tabletPage);
        expectSingleInteractiveHomepagePanel(state, 'video');

        const videoColumns = await tabletPage.evaluate(() => {
          const grid = document.querySelector('#videoGrid');
          const style = grid ? window.getComputedStyle(grid) : null;
          const rect = grid?.getBoundingClientRect();
          const gap = Number.parseFloat(style?.columnGap || '') || 8;
          const columnWidth = Number.parseFloat(style?.columnWidth || '') || 212;
          return rect?.width
            ? Math.max(1, Math.floor((rect.width + gap) / (columnWidth + gap)))
            : 0;
        });
        expect(videoColumns, `${label} video columns`).toBe(expectedColumns);
      } finally {
        await context.close();
      }
    }
  });

  test('desktop homepage staged layout remains on the true desktop hover media path', async ({ browser }) => {
    for (const viewport of [
      { width: 1366, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport });
      const desktopPage = await context.newPage();

      try {
        await desktopPage.goto('/');
        await expect(desktopPage.locator('#homeCategories')).toHaveAttribute('data-stage-mode', 'desktop');
        await waitForHomepageCategoryStage(desktopPage);

        const initialState = await readHomepageResponsiveStageState(desktopPage);
        expect(initialState.media.desktopHover, `${viewport.width} desktop hover`).toBe(true);
        expect(initialState.media.tabletDesktopLayout, `${viewport.width} tablet media`).toBe(false);
        expect(initialState.media.stagedLayout, `${viewport.width} staged media`).toBe(true);
        expect(initialState.desktopLinksVisible, `${viewport.width} nav links`).toBe(true);
        expect(initialState.mobileMenuVisible, `${viewport.width} mobile menu`).toBe(false);
        expect(initialState.overflowX, `${viewport.width} overflow`).toBeLessThanOrEqual(2);
        expectSingleInteractiveHomepagePanel(initialState, 'video');

        await desktopPage.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
        await expectActiveHomepageCategory(desktopPage, 'gallery');
        await waitForHomepageCategoryStage(desktopPage);
        await expectHomepageHeaderCategoryGlow(desktopPage, 'gallery');

        const galleryColumns = await desktopPage.evaluate(() => {
          const grid = document.getElementById('galleryGrid');
          const style = window.getComputedStyle(grid);
          const gap = Number.parseFloat(style.columnGap) || 8;
          const columnWidth = Number.parseFloat(style.columnWidth) || 216;
          return Math.max(1, Math.floor((grid.getBoundingClientRect().width + gap) / (columnWidth + gap)));
        });
        expect(galleryColumns, `${viewport.width} gallery columns`).toBeGreaterThanOrEqual(5);

        await desktopPage.locator('#navbar .site-nav__links').getByRole('link', { name: 'Video' }).click();
        await expectActiveHomepageCategory(desktopPage, 'video');
        await waitForHomepageCategoryStage(desktopPage);
        const videoColumns = await desktopPage.evaluate(() => {
          const grid = document.getElementById('videoGrid');
          const style = window.getComputedStyle(grid);
          const gap = Number.parseFloat(style.columnGap) || 8;
          const columnWidth = Number.parseFloat(style.columnWidth) || 216;
          return Math.max(1, Math.floor((grid.getBoundingClientRect().width + gap) / (columnWidth + gap)));
        });
        expect(videoColumns, `${viewport.width} video columns`).toBeGreaterThanOrEqual(5);
      } finally {
        await context.close();
      }
    }
  });

  test('MODELS opens the homepage models overlay from the hero CTA without navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const videoRequests = [];
    await routeHomepageVideoHoverFixtures(page, {
      videoRequests,
      items: Array.from({ length: 10 }, (_, index) => {
        const rank = index + 1;
        const id = `models-module-${rank.toString().padStart(2, '0')}`;
        return {
          id,
          slug: id,
          published_at: `2026-05-${(12 - index).toString().padStart(2, '0')}T08:00:00.000Z`,
          category: 'memvids',
          file: { url: `/api/gallery/memvids/${id}/vpub/file` },
          poster: { url: `/api/gallery/memvids/${id}/vpub/poster`, w: 1280, h: 720 },
        };
      }),
    });
    await page.goto('/');

    await expect(page.locator('#navbar .site-nav__links').getByRole('button', { name: 'Models' })).toHaveCount(0);
    const modelsButtons = page.locator('#hero .hero__models-cta');
    const rightModelsButton = page.locator('#hero .hero__models-cta--right');
    const leftModelsButton = page.locator('#hero .hero__models-cta--left');
    const rightModelsModule = rightModelsButton.locator('.latest-models-video-module');
    const leftModelsModule = leftModelsButton.locator('.latest-models-video-module');
    const topSlot = rightModelsModule.locator('[data-latest-models-slot="top"]');
    const bottomSlot = rightModelsModule.locator('[data-latest-models-slot="bottom"]');
    const leftTopSlot = leftModelsModule.locator('[data-latest-models-slot="top"]');
    const leftBottomSlot = leftModelsModule.locator('[data-latest-models-slot="bottom"]');
    await expect(modelsButtons).toHaveCount(2);
    await expect(rightModelsButton).toBeVisible();
    await expect(leftModelsButton).toBeVisible();
    await expect(rightModelsButton).toHaveAccessibleName('Open Models');
    await expect(leftModelsButton).toHaveAccessibleName('Open Models');
    await expect(rightModelsButton).not.toContainText('NEW MODELS');
    await expect(leftModelsButton).not.toContainText('NEW MODELS');
    await expect(modelsButtons.locator('img.hero__models-cta-image')).toHaveCount(0);
    await expect(rightModelsModule).toBeVisible();
    await expect(leftModelsModule).toBeVisible();
    await expect(rightModelsModule.locator('.latest-models-video-module__label')).toHaveText('Platform Models');
    await expect(leftModelsModule.locator('.latest-models-video-module__label')).toHaveText('Platform Models');
    await expect(page.locator('#hero')).not.toContainText('Platform Modelle');
    await expect(rightModelsModule).toHaveAttribute('data-video-module-state', 'ready');
    await expect(leftModelsModule).toHaveAttribute('data-video-module-state', 'ready');
    await expect(topSlot).toHaveAttribute('data-active-video-id', 'models-module-01');
    await expect(bottomSlot).toHaveAttribute('data-active-video-id', 'models-module-02');
    await expect(leftTopSlot).toHaveAttribute('data-active-video-id', 'models-module-06');
    await expect(leftBottomSlot).toHaveAttribute('data-active-video-id', 'models-module-07');
    await expect(topSlot).toHaveAttribute('data-next-delay-ms', '4000');
    await expect(bottomSlot).toHaveAttribute('data-next-delay-ms', '2000');
    await expect(leftTopSlot).toHaveAttribute('data-next-delay-ms', '4000');
    await expect(leftBottomSlot).toHaveAttribute('data-next-delay-ms', '2000');
    await expect(topSlot.locator('video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/models-module-01\/vpub\/file$/);
    await expect(leftTopSlot.locator('video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/models-module-06\/vpub\/file$/);
    await expect(leftBottomSlot.locator('video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/models-module-07\/vpub\/file$/);

    await expect
      .poll(async () => bottomSlot.evaluate((slot) => {
        const incoming = slot.querySelector('.latest-models-video-module__face--right video');
        if (!incoming) return '';
        incoming.dataset.continuityMarker = 'bottom-incoming-survives';
        return incoming.getAttribute('src') || '';
      }), { timeout: 3000 })
      .toContain('/api/gallery/memvids/models-module-03/vpub/file');
    await expect
      .poll(async () => bottomSlot.evaluate((slot) => {
        const incoming = slot.querySelector('.latest-models-video-module__face--front video');
        if (slot.classList.contains('is-turning') || !incoming) return '';
        return [
          incoming.dataset.continuityMarker || '',
          slot.dataset.nextDelayMs || '',
          slot.dataset.transitionCount || '',
          incoming.getAttribute('src') || '',
        ].join('|');
      }), { timeout: 2200 })
      .toContain('bottom-incoming-survives|4000|1|/api/gallery/memvids/models-module-03/vpub/file');
    await expect.poll(() => bottomSlot.getAttribute('data-transition-count'), { timeout: 3200 }).toBe('1');
    expect(['0', '1']).toContain(await topSlot.getAttribute('data-transition-count'));

    await expect
      .poll(async () => topSlot.evaluate((slot) => {
        const incoming = slot.querySelector('.latest-models-video-module__face--right video');
        if (!incoming) return '';
        incoming.dataset.continuityMarker = 'top-incoming-survives';
        return incoming.getAttribute('src') || '';
      }), { timeout: 2600 })
      .toContain('/api/gallery/memvids/models-module-02/vpub/file');
    await expect.poll(() => topSlot.getAttribute('data-transition-count'), { timeout: 1200 }).toBe('1');
    await expect
      .poll(async () => topSlot.evaluate((slot) => {
        const incoming = slot.querySelector('.latest-models-video-module__face--front video');
        if (slot.classList.contains('is-turning') || !incoming) return '';
        return [
          incoming.dataset.continuityMarker || '',
          slot.dataset.nextDelayMs || '',
          slot.dataset.transitionCount || '',
          incoming.getAttribute('src') || '',
        ].join('|');
      }), { timeout: 2200 })
      .toContain('top-incoming-survives|4000|1|/api/gallery/memvids/models-module-02/vpub/file');
    await expect.poll(() => videoRequests.slice(), { timeout: 3000 }).toEqual(expect.arrayContaining([
      '/api/gallery/memvids/models-module-01/vpub/file',
      '/api/gallery/memvids/models-module-02/vpub/file',
      '/api/gallery/memvids/models-module-03/vpub/file',
      '/api/gallery/memvids/models-module-06/vpub/file',
      '/api/gallery/memvids/models-module-07/vpub/file',
    ]));

    await rightModelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page, { homepage: true });

    await page.getByRole('button', { name: 'Close models' }).click();
    await expect(page.locator('.models-overlay')).not.toHaveClass(/is-active/);
    await expectPathUnchanged(page, '/');

    await leftModelsButton.click();
    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page, { homepage: true });
  });

  test('homepage Models video module prefers configured hero derivative slots before Memvid fallback', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const videoRequests = [];
    const heroSlots = ['right_top', 'right_bottom', 'left_top', 'left_bottom'].map((slot, index) => ({
      slot,
      version: `vhero${index + 1}`,
      title: `Configured ${slot}`,
      source_type: 'admin_asset',
      file: {
        url: `/api/homepage/hero-videos/${slot}/vhero${index + 1}/file`,
        mime_type: 'video/mp4',
        width: 720,
        height: 405,
        size_bytes: 1400000,
        duration_seconds: 6,
      },
      poster: {
        url: `/api/homepage/hero-videos/${slot}/vhero${index + 1}/poster`,
        mime_type: 'image/webp',
        width: 720,
        height: 405,
        size_bytes: 90000,
      },
    }));
    await routeHomepageVideoHoverFixtures(page, {
      videoRequests,
      homepageHeroVideos: {
        ok: true,
        data: {
          configured: true,
          slots: heroSlots,
          slot_order: ['right_top', 'right_bottom', 'left_top', 'left_bottom'],
        },
      },
      items: Array.from({ length: 10 }, (_, index) => {
        const id = `fallback-module-${index + 1}`;
        return {
          id,
          slug: id,
          published_at: `2026-05-${(12 - index).toString().padStart(2, '0')}T08:00:00.000Z`,
          category: 'memvids',
          file: { url: `/api/gallery/memvids/${id}/vpub/file` },
          poster: { url: `/api/gallery/memvids/${id}/vpub/poster`, w: 1280, h: 720 },
        };
      }),
    });
    await page.goto('/');

    const rightModule = page.locator('#hero .hero__models-cta--right .latest-models-video-module');
    const leftModule = page.locator('#hero .hero__models-cta--left .latest-models-video-module');
    const rightTop = rightModule.locator('[data-latest-models-slot="top"]');
    const rightBottom = rightModule.locator('[data-latest-models-slot="bottom"]');
    const leftTop = leftModule.locator('[data-latest-models-slot="top"]');
    const leftBottom = leftModule.locator('[data-latest-models-slot="bottom"]');

    await expect(rightModule).toHaveAttribute('data-video-module-state', 'ready');
    await expect(leftModule).toHaveAttribute('data-video-module-state', 'ready');
    await expect(rightTop.locator('video')).toHaveAttribute('src', /\/api\/homepage\/hero-videos\/right_top\/vhero1\/file$/);
    await expect(rightBottom.locator('video')).toHaveAttribute('src', /\/api\/homepage\/hero-videos\/right_bottom\/vhero2\/file$/);
    await expect(leftTop.locator('video')).toHaveAttribute('src', /\/api\/homepage\/hero-videos\/left_top\/vhero3\/file$/);
    await expect(leftBottom.locator('video')).toHaveAttribute('src', /\/api\/homepage\/hero-videos\/left_bottom\/vhero4\/file$/);
    await expect(rightTop).toHaveAttribute('data-active-video-id', /homepage-hero-right_top-vhero1/);
    await expect(leftBottom).toHaveAttribute('data-active-video-id', /homepage-hero-left_bottom-vhero4/);
    expect(videoRequests).toEqual(expect.arrayContaining([
      '/api/homepage/hero-videos/right_top/vhero1/file',
      '/api/homepage/hero-videos/right_bottom/vhero2/file',
      '/api/homepage/hero-videos/left_top/vhero3/file',
      '/api/homepage/hero-videos/left_bottom/vhero4/file',
    ]));
  });

  test('tablet homepage hero shows Models videos and creation streams while phones stay lightweight', async ({ browser }) => {
    const buildHeroSlots = () => ['right_top', 'right_bottom', 'left_top', 'left_bottom'].map((slot, index) => ({
      slot,
      version: `tabletv${index + 1}`,
      title: `Tablet ${slot}`,
      source_type: 'admin_asset',
      file: {
        url: `/api/homepage/hero-videos/${slot}/tabletv${index + 1}/file`,
        mime_type: 'video/mp4',
        width: 720,
        height: 405,
        size_bytes: 1400000,
        duration_seconds: 6,
      },
      poster: {
        url: `/api/homepage/hero-videos/${slot}/tabletv${index + 1}/poster`,
        mime_type: 'image/webp',
        width: 720,
        height: 405,
        size_bytes: 90000,
      },
    }));
    const homepageHeroVideos = {
      ok: true,
      data: {
        configured: true,
        slots: buildHeroSlots(),
        slot_order: ['right_top', 'right_bottom', 'left_top', 'left_bottom'],
      },
    };

    const openTouchPage = async (viewport) => {
      const context = await browser.newContext({
        baseURL: 'http://localhost:3000',
        viewport,
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const videoRequests = [];
      await routeHomepageVideoHoverFixtures(page, {
        videoRequests,
        homepageHeroVideos,
        items: [],
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      return { context, page, videoRequests };
    };

    const assertTabletHeroVisuals = async (viewport, label) => {
      const { context, page, videoRequests } = await openTouchPage(viewport);
      try {
        await expect(page.locator('#hero .hero__models-cta')).toHaveCount(2);
        await expect(page.locator('#hero .hero__models-cta--left')).toBeVisible();
        await expect(page.locator('#hero .hero__models-cta--right')).toBeVisible();
        await expect(page.locator('#hero .latest-models-video-module__slot')).toHaveCount(4);
        await expect(page.locator('#hero .latest-models-video-module__slot video')).toHaveCount(4);
        await expect(page.locator('#hero .latest-models-video-module[data-video-module-state="ready"]')).toHaveCount(2);
        await expect(page.locator('#hero .hero__creation-stream[data-creation-stream-anchored="true"]')).toHaveCount(2);

        const metrics = await page.evaluate(() => {
          const stream = document.querySelector('#hero .hero__creation-stream');
          const slots = Array.from(document.querySelectorAll('#hero .latest-models-video-module__slot'));
          return {
            legacyDesktopVideoGate: window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches,
            heroVisualMedia: window.matchMedia('(min-width: 1024px), (min-width: 768px) and (max-width: 1023px) and (min-height: 700px)').matches,
            streamDisplay: stream ? window.getComputedStyle(stream).display : '',
            visibleSlotCount: slots.filter((slot) => {
              const rect = slot.getBoundingClientRect();
              const style = window.getComputedStyle(slot);
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            }).length,
          };
        });
        expect(metrics.heroVisualMedia, `${label} hero visual media`).toBe(true);
        expect(metrics.streamDisplay, `${label} stream display`).not.toBe('none');
        expect(metrics.visibleSlotCount, `${label} visible hero video slots`).toBe(4);
        expect(videoRequests, `${label} configured hero videos requested`).toEqual(expect.arrayContaining([
          '/api/homepage/hero-videos/right_top/tabletv1/file',
          '/api/homepage/hero-videos/right_bottom/tabletv2/file',
          '/api/homepage/hero-videos/left_top/tabletv3/file',
          '/api/homepage/hero-videos/left_bottom/tabletv4/file',
        ]));
        return metrics;
      } finally {
        await context.close();
      }
    };

    const iPadProLike = await assertTabletHeroVisuals({ width: 1366, height: 1024 }, 'iPad Pro landscape');
    expect(iPadProLike.legacyDesktopVideoGate, 'touch tablet should not depend on hover/fine media').toBe(false);
    await assertTabletHeroVisuals({ width: 820, height: 1180 }, 'tablet portrait');

    const { context: phoneContext, page: phonePage, videoRequests: phoneVideoRequests } = await openTouchPage({ width: 390, height: 844 });
    try {
      await expect(phonePage.locator('#hero .hero__models-cta')).toHaveCount(2);
      await expect(phonePage.locator('#hero .hero__models-cta--left')).toBeHidden();
      await expect(phonePage.locator('#hero .hero__models-cta--right')).toBeHidden();
      await expect(phonePage.locator('#hero .latest-models-video-module__slot video')).toHaveCount(0);
      const phoneMetrics = await phonePage.evaluate(() => ({
        heroVisualMedia: window.matchMedia('(min-width: 1024px), (min-width: 768px) and (max-width: 1023px) and (min-height: 700px)').matches,
        streamDisplays: Array.from(document.querySelectorAll('#hero .hero__creation-stream'))
          .map((stream) => window.getComputedStyle(stream).display),
      }));
      expect(phoneMetrics.heroVisualMedia).toBe(false);
      expect(phoneMetrics.streamDisplays.every((display) => display === 'none')).toBe(true);
      expect(phoneVideoRequests).toEqual([]);
    } finally {
      await phoneContext.close();
    }
  });

  for (const { path, galleryLabel } of [
    { path: '/', galleryLabel: 'Gallery' },
    { path: '/de/', galleryLabel: 'Galerie' },
  ]) {
    test(`homepage Models video module sits flush right below the header without crowding ${galleryLabel} on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.route('**/api/public/news-pulse**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], updated_at: '2026-05-09T08:00:00.000Z' }),
        });
      });

      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const modelsButtons = page.locator('#hero .hero__models-cta');
      const modelsButton = page.locator('#hero .hero__models-cta--right');
      const leftModelsButton = page.locator('#hero .hero__models-cta--left');
      await expect(modelsButtons).toHaveCount(2);
      await expect(modelsButton).toBeVisible();
      await expect(leftModelsButton).toBeVisible();
      await expect(modelsButton.locator('.latest-models-video-module')).toBeVisible();
      await expect(leftModelsButton.locator('.latest-models-video-module')).toBeVisible();
      const expectedModuleLabel = path === '/de/' ? 'Plattform Modelle' : 'Platform Models';
      await expect(modelsButton.locator('.latest-models-video-module__label')).toHaveText(expectedModuleLabel);
      await expect(leftModelsButton.locator('.latest-models-video-module__label')).toHaveText(expectedModuleLabel);
      await expect(page.locator('#hero')).not.toContainText('Plattform-Modelle');
      await expect(page.locator('#hero')).not.toContainText('Platform-Models');
      await expect(page.locator('#hero')).not.toContainText('Plattform-Models');
      await expect(modelsButtons.locator('img.hero__models-cta-image')).toHaveCount(0);

      const readLayout = async () => page.evaluate(() => {
        const ctaNode = document.querySelector('#hero .hero__models-cta--right');
        const leftCtaNode = document.querySelector('#hero .hero__models-cta--left');
        const moduleNode = ctaNode.querySelector('.latest-models-video-module');
        const leftModuleNode = leftCtaNode.querySelector('.latest-models-video-module');
        const topSlotNode = moduleNode.querySelector('[data-latest-models-slot="top"]');
        const bottomSlotNode = moduleNode.querySelector('[data-latest-models-slot="bottom"]');
        const edgeGlowNode = moduleNode.querySelector('.latest-models-video-module__edge-glow');
        const leftEdgeGlowNode = leftModuleNode.querySelector('.latest-models-video-module__edge-glow');
        const edgeGlowHaloNode = edgeGlowNode?.querySelector('.latest-models-video-module__edge-glow-path--halo');
        const edgeGlowPathNode = edgeGlowNode?.querySelector('.latest-models-video-module__edge-glow-path--core');
        const edgeGlowHighlightNode = edgeGlowNode?.querySelector('.latest-models-video-module__edge-glow-path--highlight');
        const leftEdgeGlowHaloNode = leftEdgeGlowNode?.querySelector('.latest-models-video-module__edge-glow-path--halo');
        const leftEdgeGlowPathNode = leftModuleNode.querySelector('.latest-models-video-module__edge-glow-path--core');
        const leftEdgeGlowHighlightNode = leftEdgeGlowNode?.querySelector('.latest-models-video-module__edge-glow-path--highlight');
        const edgeGlowFilterNode = edgeGlowNode?.querySelector('#latestModelsEdgeGlowSoft');
        const leftEdgeGlowFilterNode = leftEdgeGlowNode?.querySelector('#latestModelsLeftEdgeGlowSoft');
        const leftEdgeGlowGradientNode = leftEdgeGlowNode?.querySelector('#latestModelsLeftEdgeGlowGradient');
        const leftEdgeHighlightGradientNode = leftEdgeGlowNode?.querySelector('#latestModelsLeftEdgeHighlightGradient');
        const topClipPathNode = document.querySelector('#latestModelsTopClip path');
        const bottomClipPathNode = document.querySelector('#latestModelsBottomClip path');
        const moduleClipPathNode = document.querySelector('#latestModelsModuleClip path');
        const leftTopClipPathNode = document.querySelector('#latestModelsLeftTopClip path');
        const leftBottomClipPathNode = document.querySelector('#latestModelsLeftBottomClip path');
        const leftModuleClipPathNode = document.querySelector('#latestModelsLeftModuleClip path');
        const labTeaserNode = document.querySelector('#hero .hero__lab-teaser');
        const labelNode = moduleNode.querySelector('.latest-models-video-module__label');
        const leftLabelNode = leftModuleNode.querySelector('.latest-models-video-module__label');
        const topMediaNode = topSlotNode.querySelector('.latest-models-video-module__cube, .latest-models-video-module__fallback');
        const bottomMediaNode = bottomSlotNode.querySelector('.latest-models-video-module__cube, .latest-models-video-module__fallback');
        const cta = ctaNode.getBoundingClientRect();
        const leftCta = leftCtaNode.getBoundingClientRect();
        const module = moduleNode.getBoundingClientRect();
        const leftModule = leftModuleNode.getBoundingClientRect();
        const edgeGlow = edgeGlowNode.getBoundingClientRect();
        const label = labelNode.getBoundingClientRect();
        const leftLabel = leftLabelNode.getBoundingClientRect();
        const topSlot = topSlotNode.getBoundingClientRect();
        const bottomSlot = bottomSlotNode.getBoundingClientRect();
        const topMedia = topMediaNode.getBoundingClientRect();
        const bottomMedia = bottomMediaNode.getBoundingClientRect();
        const title = document.querySelector('#hero .hero__title-img').getBoundingClientRect();
        const pulseNode = document.querySelector('#newsPulse');
        const pulse = pulseNode.getBoundingClientRect();
        const hero = document.querySelector('#hero').getBoundingClientRect();
        const nav = document.querySelector('#navbar').getBoundingClientRect();
        const guest = document.querySelector('#mobileGuestBanner')?.getBoundingClientRect();
        const ctaStyle = getComputedStyle(ctaNode);
        const ctaBeforeStyle = getComputedStyle(ctaNode, '::before');
        const edgeGlowStyle = getComputedStyle(edgeGlowNode);
        const edgeGlowHaloStyle = getComputedStyle(edgeGlowHaloNode);
        const edgeGlowPathStyle = getComputedStyle(edgeGlowPathNode);
        const edgeGlowHighlightStyle = getComputedStyle(edgeGlowHighlightNode);
        const leftEdgeGlowHaloStyle = getComputedStyle(leftEdgeGlowHaloNode);
        const leftEdgeGlowPathStyle = getComputedStyle(leftEdgeGlowPathNode);
        const leftEdgeGlowHighlightStyle = getComputedStyle(leftEdgeGlowHighlightNode);
        const labTeaserAfterStyle = getComputedStyle(labTeaserNode, '::after');
        const moduleBeforeStyle = getComputedStyle(moduleNode, '::before');
        const moduleAfterStyle = getComputedStyle(moduleNode, '::after');
        const labelStyle = getComputedStyle(labelNode);
        const leftLabelStyle = getComputedStyle(leftLabelNode);
        const pulseStyle = getComputedStyle(pulseNode);
        const topSlotStyle = getComputedStyle(topSlotNode);
        const bottomSlotStyle = getComputedStyle(bottomSlotNode);
        const topSlotBeforeStyle = getComputedStyle(topSlotNode, '::before');
        const bottomSlotBeforeStyle = getComputedStyle(bottomSlotNode, '::before');
        const topSlotAfterStyle = getComputedStyle(topSlotNode, '::after');
        const bottomSlotAfterStyle = getComputedStyle(bottomSlotNode, '::after');
        const ids = [...document.querySelectorAll('[id]')].map((node) => node.id).filter(Boolean);
        const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
        const guestClear = !guest?.width || !guest?.height || (
          guest.right <= cta.left - 8 ||
          guest.left >= cta.right + 8 ||
          guest.bottom <= cta.top - 8 ||
          guest.top >= cta.bottom + 8
        );
        return {
          ctaRightInset: hero.right - cta.right,
          leftCtaLeftInset: leftCta.left - hero.left,
          ctaTop: cta.top,
          ctaLeft: cta.left,
          ctaRight: cta.right,
          ctaCenterX: cta.left + cta.width / 2,
          leftCtaTop: leftCta.top,
          leftCtaLeft: leftCta.left,
          leftCtaRight: leftCta.right,
          leftCtaCenterX: leftCta.left + leftCta.width / 2,
          moduleTop: module.top,
          moduleBottom: module.bottom,
          moduleLeft: module.left,
          moduleWidth: module.width,
          moduleHeight: module.height,
          leftModuleTop: leftModule.top,
          leftModuleBottom: leftModule.bottom,
          leftModuleLeft: leftModule.left,
          leftModuleWidth: leftModule.width,
          leftModuleHeight: leftModule.height,
          labelTop: label.top,
          labelBottom: label.bottom,
          labelCenterX: label.left + label.width / 2,
          labelTransform: labelStyle.transform,
          leftLabelCenterX: leftLabel.left + leftLabel.width / 2,
          leftLabelTransform: leftLabelStyle.transform,
          topSlotTop: topSlot.top,
          topSlotBottom: topSlot.bottom,
          topSlotHeight: topSlot.height,
          bottomSlotBottom: bottomSlot.bottom,
          topSlotRight: topSlot.right,
          bottomSlotTop: bottomSlot.top,
          bottomSlotRight: bottomSlot.right,
          topMediaTop: topMedia.top,
          topMediaBottom: topMedia.bottom,
          topMediaHeight: topMedia.height,
          bottomMediaTop: bottomMedia.top,
          bottomMediaBottom: bottomMedia.bottom,
          bottomMediaHeight: bottomMedia.height,
          titleTop: title.top,
          titleRight: title.right,
          titleLeft: title.left,
          heroLeft: hero.left,
          heroRight: hero.right,
          heroTop: hero.top,
          heroWidth: hero.width,
          heroCenterX: hero.left + hero.width / 2,
          navBottom: nav.bottom,
          pulseDisplay: pulseStyle.display,
          pulseVisibility: pulseStyle.visibility,
          pulseHidden: pulseNode.hasAttribute('hidden'),
          pulseWidth: pulse.width,
          pulseHeight: pulse.height,
          ctaBoxShadow: ctaStyle.boxShadow,
          ctaBeforeContent: ctaBeforeStyle.content,
          edgeGlowTop: edgeGlow.top,
          edgeGlowBottom: edgeGlow.bottom,
          edgeGlowLeft: edgeGlow.left,
          edgeGlowRight: edgeGlow.right,
          edgeGlowPointerEvents: edgeGlowStyle.pointerEvents,
          edgeGlowZIndex: Number.parseInt(edgeGlowStyle.zIndex || '0', 10),
          edgeGlowPathD: edgeGlowPathNode?.getAttribute('d') || '',
          leftEdgeGlowPathD: leftEdgeGlowPathNode?.getAttribute('d') || '',
          edgeGlowPathStroke: edgeGlowPathStyle.stroke,
          edgeGlowHaloFilter: edgeGlowHaloStyle.filter,
          leftEdgeGlowHaloStroke: leftEdgeGlowHaloStyle.stroke,
          leftEdgeGlowHaloFilter: leftEdgeGlowHaloStyle.filter,
          leftEdgeGlowHaloStrokeWidth: Number.parseFloat(leftEdgeGlowHaloStyle.strokeWidth || '0'),
          leftEdgeGlowHaloOpacity: Number.parseFloat(leftEdgeGlowHaloStyle.opacity || '0'),
          leftEdgeGlowPathStroke: leftEdgeGlowPathStyle.stroke,
          leftEdgeGlowHighlightStroke: leftEdgeGlowHighlightStyle.stroke,
          edgeGlowFilterX: edgeGlowFilterNode?.getAttribute('x') || '',
          edgeGlowFilterWidth: edgeGlowFilterNode?.getAttribute('width') || '',
          leftEdgeGlowFilterUnits: leftEdgeGlowFilterNode?.getAttribute('filterUnits') || '',
          leftEdgeGlowFilterX: Number.parseFloat(leftEdgeGlowFilterNode?.getAttribute('x') || '0'),
          leftEdgeGlowFilterY: Number.parseFloat(leftEdgeGlowFilterNode?.getAttribute('y') || '0'),
          leftEdgeGlowFilterWidth: Number.parseFloat(leftEdgeGlowFilterNode?.getAttribute('width') || '0'),
          leftEdgeGlowFilterHeight: Number.parseFloat(leftEdgeGlowFilterNode?.getAttribute('height') || '0'),
          leftEdgeGlowGradientX1: leftEdgeGlowGradientNode?.getAttribute('x1') || '',
          leftEdgeGlowGradientX2: leftEdgeGlowGradientNode?.getAttribute('x2') || '',
          leftEdgeHighlightGradientX1: leftEdgeHighlightGradientNode?.getAttribute('x1') || '',
          leftEdgeHighlightGradientX2: leftEdgeHighlightGradientNode?.getAttribute('x2') || '',
          topClipPathD: topClipPathNode?.getAttribute('d') || '',
          bottomClipPathD: bottomClipPathNode?.getAttribute('d') || '',
          moduleClipPathD: moduleClipPathNode?.getAttribute('d') || '',
          leftTopClipPathD: leftTopClipPathNode?.getAttribute('d') || '',
          leftBottomClipPathD: leftBottomClipPathNode?.getAttribute('d') || '',
          leftModuleClipPathD: leftModuleClipPathNode?.getAttribute('d') || '',
          edgeGlowHaloStrokeWidth: Number.parseFloat(edgeGlowHaloStyle.strokeWidth || '0'),
          edgeGlowHaloOpacity: Number.parseFloat(edgeGlowHaloStyle.opacity || '0'),
          edgeGlowCoreStrokeWidth: Number.parseFloat(edgeGlowPathStyle.strokeWidth || '0'),
          edgeGlowCoreOpacity: Number.parseFloat(edgeGlowPathStyle.opacity || '0'),
          edgeGlowHighlightStrokeWidth: Number.parseFloat(edgeGlowHighlightStyle.strokeWidth || '0'),
          edgeGlowHighlightOpacity: Number.parseFloat(edgeGlowHighlightStyle.opacity || '0'),
          labTeaserAfterContent: labTeaserAfterStyle.content,
          labTeaserAfterInsetInlineStart: labTeaserAfterStyle.insetInlineStart,
          labTeaserAfterInsetInlineEnd: labTeaserAfterStyle.insetInlineEnd,
          labTeaserAfterBackgroundPositionX: labTeaserAfterStyle.backgroundPositionX,
          labTeaserAfterClipPath: labTeaserAfterStyle.clipPath,
          moduleBeforeContent: moduleBeforeStyle.content,
          moduleAfterContent: moduleAfterStyle.content,
          topSlotBoxShadow: topSlotStyle.boxShadow,
          bottomSlotBoxShadow: bottomSlotStyle.boxShadow,
          topSlotZIndex: Number.parseInt(topSlotStyle.zIndex || '0', 10),
          bottomSlotZIndex: Number.parseInt(bottomSlotStyle.zIndex || '0', 10),
          topSlotClipPath: topSlotStyle.clipPath,
          bottomSlotClipPath: bottomSlotStyle.clipPath,
          topSlotBeforeContent: topSlotBeforeStyle.content,
          bottomSlotBeforeContent: bottomSlotBeforeStyle.content,
          topSlotAfterContent: topSlotAfterStyle.content,
          bottomSlotAfterContent: bottomSlotAfterStyle.content,
          duplicateIds,
          guestClear,
        };
      });

      const assertLayout = (layout) => {
        expect(layout.ctaRightInset).toBeLessThanOrEqual(1);
        expect(layout.leftCtaLeftInset).toBeGreaterThanOrEqual(-1);
        expect(layout.ctaLeft).toBeGreaterThanOrEqual(layout.heroLeft + layout.heroWidth * 0.76);
        expect(layout.ctaRight).toBeLessThanOrEqual(layout.heroRight + 1);
        expect(layout.leftCtaLeft).toBeGreaterThanOrEqual(layout.heroLeft - 1);
        expect(layout.leftCtaRight).toBeLessThanOrEqual(layout.heroLeft + layout.heroWidth * 0.24);
        expectWithinPx(layout.ctaTop, layout.leftCtaTop, 'left/right Models top alignment', 1.5);
        expectWithinPx(layout.moduleWidth, layout.leftModuleWidth, 'left/right Models width', 1);
        expectWithinPx(layout.moduleHeight, layout.leftModuleHeight, 'left/right Models height', 1);
        expectWithinPx(layout.moduleTop, layout.leftModuleTop, 'left/right Models module top', 1.5);
        expectWithinPx(layout.moduleBottom, layout.leftModuleBottom, 'left/right Models module bottom', 1.5);
        expectWithinPx(
          layout.ctaCenterX - layout.heroCenterX,
          layout.heroCenterX - layout.leftCtaCenterX,
          'left/right Models center mirror',
          2,
        );
        expect(Math.abs(layout.topSlotTop - layout.navBottom)).toBeLessThanOrEqual(2);
        expect(layout.topSlotRight).toBeLessThanOrEqual(layout.heroRight + 1);
        expect(layout.bottomSlotRight).toBeLessThanOrEqual(layout.heroRight + 1);
        expect(Math.abs(layout.bottomSlotTop - layout.topSlotTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(layout.bottomSlotBottom - layout.topSlotBottom)).toBeLessThanOrEqual(1);
        const seamY = layout.topSlotTop + layout.topSlotHeight * 0.5;
        expect(layout.labelTop).toBeGreaterThanOrEqual(layout.bottomSlotBottom + 4);
        expect(layout.labelBottom).toBeLessThan(layout.moduleBottom - 8);
        expect(layout.labelCenterX).toBeGreaterThan(layout.moduleLeft + layout.moduleWidth * 0.48);
        expect(layout.labelCenterX).toBeLessThan(layout.moduleLeft + layout.moduleWidth * 0.78);
        expect(layout.leftLabelCenterX).toBeGreaterThan(layout.leftModuleLeft + layout.leftModuleWidth * 0.22);
        expect(layout.leftLabelCenterX).toBeLessThan(layout.leftModuleLeft + layout.leftModuleWidth * 0.52);
        expect(layout.labelTransform).not.toBe('none');
        expect(layout.leftLabelTransform).not.toContain('-1, 0');
        expect(layout.pulseDisplay).not.toBe('none');
        expect(layout.pulseVisibility).toBe('visible');
        expect(layout.pulseHidden).toBe(false);
        expect(layout.pulseWidth).toBeGreaterThan(320);
        expect(layout.pulseHeight).toBeGreaterThan(70);
        expect(Math.abs(layout.topMediaTop - layout.moduleTop)).toBeLessThanOrEqual(1);
        expect(layout.topMediaBottom).toBeGreaterThanOrEqual(seamY);
        expect(layout.topMediaBottom).toBeLessThanOrEqual(seamY + 9);
        expect(layout.bottomMediaTop).toBeLessThanOrEqual(seamY);
        expect(layout.bottomMediaTop).toBeGreaterThanOrEqual(seamY - 9);
        expect(layout.bottomMediaBottom).toBeLessThanOrEqual(layout.bottomSlotBottom + 1);
        expect(layout.bottomMediaBottom).toBeGreaterThanOrEqual(layout.bottomSlotBottom - 1);
        expect(layout.topMediaHeight).toBeGreaterThan(layout.topSlotHeight * 0.5);
        expect(layout.bottomMediaHeight).toBeGreaterThan(layout.topSlotHeight * 0.5);
        expect(layout.bottomMediaTop - layout.topMediaBottom).toBeLessThanOrEqual(-4);
        expect(layout.ctaBoxShadow).toBe('none');
        expect(layout.ctaBeforeContent).toBe('none');
        expect(Math.abs(layout.edgeGlowTop - layout.moduleTop)).toBeLessThanOrEqual(1);
        expect(layout.edgeGlowBottom).toBeLessThan(layout.labelTop);
        expect(Math.abs(layout.edgeGlowLeft - layout.moduleLeft)).toBeLessThanOrEqual(1);
        expect(layout.edgeGlowRight).toBeLessThanOrEqual(layout.moduleLeft + layout.moduleWidth + 1);
        expect(layout.edgeGlowPointerEvents).toBe('none');
        expect(layout.edgeGlowZIndex).toBeLessThan(layout.topSlotZIndex);
        expect(layout.edgeGlowZIndex).toBeLessThan(layout.bottomSlotZIndex);
        expect(layout.edgeGlowPathD).toBe('M 34 0 C 16 2 4 18 4 34 C 4 48 18 56 14 64 C 8 76 3 86 20 100');
        expect(layout.leftEdgeGlowPathD).toBe('M 66 0 C 84 2 96 18 96 34 C 96 48 82 56 86 64 C 92 76 97 86 80 100');
        expect(layout.moduleClipPathD).toBe('M 1 0 L 0.34 0 C 0.16 0.02 0.04 0.18 0.04 0.34 C 0.04 0.48 0.18 0.56 0.14 0.64 C 0.08 0.76 0.03 0.86 0.2 1 L 1 1 Z');
        expect(layout.topClipPathD).toBe('M 1 0 L 0.34 0 C 0.16 0.02 0.04 0.18 0.04 0.34 C 0.04 0.403945 0.069207 0.455372 0.097128 0.5 C 0.31 0.545 0.58 0.47 1 0.5 Z');
        expect(layout.bottomClipPathD).toBe('M 1 0.486 C 0.58 0.456 0.31 0.531 0.088501 0.486 C 0.124508 0.545559 0.16361 0.59278 0.14 0.64 C 0.08 0.76 0.03 0.86 0.2 1 L 1 1 Z');
        expect(layout.leftModuleClipPathD).toBe('M 0 0 L 0.66 0 C 0.84 0.02 0.96 0.18 0.96 0.34 C 0.96 0.48 0.82 0.56 0.86 0.64 C 0.92 0.76 0.97 0.86 0.8 1 L 0 1 Z');
        expect(layout.leftTopClipPathD).toBe('M 0 0 L 0.66 0 C 0.84 0.02 0.96 0.18 0.96 0.34 C 0.96 0.403945 0.930793 0.455372 0.902872 0.5 C 0.69 0.545 0.42 0.47 0 0.5 Z');
        expect(layout.leftBottomClipPathD).toBe('M 0 0.486 C 0.42 0.456 0.69 0.531 0.911499 0.486 C 0.875492 0.545559 0.83639 0.59278 0.86 0.64 C 0.92 0.76 0.97 0.86 0.8 1 L 0 1 Z');
        expect(layout.edgeGlowPathStroke).toContain('latestModelsEdgeGlowGradient');
        expect(layout.leftEdgeGlowHaloStroke).toContain('latestModelsLeftEdgeGlowGradient');
        expect(layout.leftEdgeGlowPathStroke).toContain('latestModelsLeftEdgeGlowGradient');
        expect(layout.leftEdgeGlowHighlightStroke).toContain('latestModelsLeftEdgeHighlightGradient');
        expect(layout.edgeGlowHaloFilter).toBe('none');
        expect(layout.leftEdgeGlowHaloFilter).toBe('none');
        expect(layout.edgeGlowFilterX).toBe('-80%');
        expect(layout.edgeGlowFilterWidth).toBe('190%');
        expect(layout.leftEdgeGlowFilterUnits).toBe('userSpaceOnUse');
        expect(layout.leftEdgeGlowFilterX).toBeLessThanOrEqual(-70);
        expect(layout.leftEdgeGlowFilterY).toBeLessThanOrEqual(-20);
        expect(layout.leftEdgeGlowFilterWidth).toBeGreaterThanOrEqual(240);
        expect(layout.leftEdgeGlowFilterHeight).toBeGreaterThanOrEqual(140);
        expect(layout.leftEdgeGlowGradientX1).toBe('90');
        expect(layout.leftEdgeGlowGradientX2).toBe('80');
        expect(layout.leftEdgeHighlightGradientX1).toBe('90');
        expect(layout.leftEdgeHighlightGradientX2).toBe('80');
        expect(layout.edgeGlowHaloStrokeWidth).toBeLessThanOrEqual(0.01);
        expect(layout.edgeGlowHaloOpacity).toBe(0);
        expect(layout.leftEdgeGlowHaloStrokeWidth).toBeLessThanOrEqual(0.01);
        expect(layout.leftEdgeGlowHaloOpacity).toBe(0);
        expect(layout.edgeGlowCoreStrokeWidth).toBeGreaterThanOrEqual(16.8);
        expect(layout.edgeGlowCoreOpacity).toBeGreaterThanOrEqual(0.99);
        expect(layout.edgeGlowHighlightStrokeWidth).toBeGreaterThanOrEqual(6);
        expect(layout.edgeGlowHighlightOpacity).toBeGreaterThanOrEqual(0.99);
        expect(layout.labTeaserAfterContent).not.toBe('none');
        expect(layout.labTeaserAfterInsetInlineStart).toBe('1px');
        expect(layout.labTeaserAfterInsetInlineEnd).toBe('1px');
        expect(layout.labTeaserAfterBackgroundPositionX).not.toBe('');
        expect(layout.labTeaserAfterClipPath).not.toBe('none');
        expect(layout.moduleBeforeContent).toBe('none');
        expect(layout.moduleAfterContent).toBe('none');
        expect(layout.topSlotBoxShadow).toBe('none');
        expect(layout.bottomSlotBoxShadow).toBe('none');
        expect(layout.topSlotClipPath).not.toBe('none');
        expect(layout.bottomSlotClipPath).not.toBe('none');
        expect(layout.topSlotBeforeContent).toBe('none');
        expect(layout.bottomSlotBeforeContent).toBe('none');
        expect(layout.topSlotAfterContent).toBe('none');
        expect(layout.bottomSlotAfterContent).toBe('none');
        expect(layout.duplicateIds).toEqual([]);
        expect(layout.titleLeft).toBeLessThan(layout.ctaLeft - 8);
        expect(layout.titleRight).toBeLessThan(layout.ctaLeft + 16);
        expect(layout.titleTop).toBeGreaterThanOrEqual(layout.navBottom + 2);
        expect(Math.abs((layout.titleTop - layout.navBottom) - (layout.ctaTop - layout.navBottom))).toBeLessThanOrEqual(18);
        expect(layout.guestClear).toBe(true);
      };

      assertLayout(await readLayout());
      await modelsButton.hover();
      await expect
        .poll(() => modelsButton.evaluate((node) => window.getComputedStyle(node).boxShadow))
        .toBe('none');
      for (const viewport of [
        { width: 1100, height: 760 },
        { width: 1600, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assertLayout(await readLayout());
      }
    });
  }

  test('MODELS opens the homepage models overlay from the mobile navigation without navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('#hero .hero__models-cta')).toHaveCount(2);
    await expect(page.locator('#hero .hero__models-cta--left')).toBeHidden();
    await expect(page.locator('#hero .hero__models-cta--right')).toBeHidden();
    await page.getByRole('button', { name: 'Toggle menu' }).click();
    const mobileExplore = page.locator('#mobileNav .mobile-nav__section[aria-label="Explore"]');
    const mobileConnect = page.locator('#mobileNav .mobile-nav__section[aria-label="Connect"]');
    await expect(mobileExplore.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect(mobileConnect.getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect
      .poll(() => mobileExplore.locator(':scope > .mobile-nav__link').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Models']);

    const modelsButton = page.locator('#mobileNav').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page, { homepage: true });
  });

  test('mobile create-account CTA overlays the hero below the header and opens registration', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.goto('/');

    const banner = page.locator('#mobileHeaderCreateAccount');
    await expect(page.locator('#mobileGuestBanner')).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText('Join for free');
    await expect(page.getByText('CREATE *FREE* ACCOUNT')).toHaveCount(0);
    await expect(page.locator('#mobileMenuBtn')).toBeVisible();
    const placement = await page.evaluate(() => {
      const cta = document.querySelector('#mobileHeaderCreateAccount')?.getBoundingClientRect();
      const nav = document.querySelector('#navbar')?.getBoundingClientRect();
      const menu = document.querySelector('#mobileMenuBtn')?.getBoundingClientRect();
      const hero = document.querySelector('#hero')?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      return {
        ctaTop: cta?.top ?? 0,
        ctaBottom: cta?.bottom ?? 0,
        ctaHeight: cta?.height ?? 0,
        ctaWidth: cta?.width ?? 0,
        ctaCenterDelta: cta ? Math.abs((cta.left + (cta.width / 2)) - (viewportWidth / 2)) : 999,
        navBottom: nav?.bottom ?? 0,
        menuBottom: menu?.bottom ?? 0,
        heroTop: hero?.top ?? 0,
        ctaOverHero: Boolean(cta && hero && cta.top >= hero.top && cta.bottom <= hero.top + 140),
        ctaPosition: cta ? window.getComputedStyle(document.querySelector('#mobileHeaderCreateAccount')).position : '',
        viewportWidth,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(placement.ctaTop).toBeGreaterThanOrEqual(placement.navBottom - 1);
    expect(placement.ctaTop).toBeGreaterThanOrEqual(placement.menuBottom - 1);
    expect(placement.ctaHeight).toBeGreaterThanOrEqual(42);
    expect(placement.ctaWidth).toBeLessThan(placement.viewportWidth * 0.78);
    expect(placement.ctaCenterDelta).toBeLessThanOrEqual(2);
    expect(placement.heroTop).toBeLessThanOrEqual(1);
    expect(placement.ctaPosition).toBe('absolute');
    expect(placement.ctaOverHero).toBe(true);
    expect(placement.overflow).toBeLessThanOrEqual(1);

    await banner.click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('.auth-modal__tab.active')).toHaveText('Create Account');
    await expect(page.locator('#authRegisterForm input[name="email"]')).toBeVisible();
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect(page.locator('.auth-modal__overlay.active')).toHaveCount(0);
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
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveCount(0);
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
    await expect(banner).toHaveText('Join for free');
    await expect(page.getByText('CREATE *FREE* ACCOUNT')).toHaveCount(0);
    const bannerMetrics = await page.evaluate(() => {
      const banner = document.querySelector('#mobileGuestBanner')?.getBoundingClientRect();
      const header = document.querySelector('#navbar .site-nav__bar')?.getBoundingClientRect();
      const title = document.querySelector('#mobileGuestBanner .mobile-guest-banner__title');
      const style = title ? window.getComputedStyle(title) : null;
      return {
        bannerCenter: banner ? banner.left + banner.width / 2 : 0,
        headerCenter: header ? header.left + header.width / 2 : 0,
        animationName: style?.animationName || '',
      };
    });
    expectWithinPx(bannerMetrics.bannerCenter, bannerMetrics.headerCenter, 'free account header center', 3);
    expect(bannerMetrics.animationName).toContain('freeAccountTextWave');
    await expect(page.locator('#authModal .auth-modal__overlay')).toHaveCount(1);

    await banner.click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('.auth-modal__tab.active')).toHaveText('Create Account');
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authRegisterForm')).toBeVisible();
    await expect(page.locator('#authRegisterForm input[name="email"]')).toBeVisible();
    await expect(page.locator('#authRegisterForm input[name="password"]')).toBeVisible();
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

  test('homepage Help Menu keeps account recovery guidance after journey removal', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.goto('/');
    await expect(page.locator('#publicMemberJourney')).toHaveCount(0);

    const trigger = page.getByRole('button', { name: 'Open help menu' });
    await trigger.click();

    const startSection = page.locator('#bitbiHelpPanel [data-help-section="start"]');
    await expect(startSection.locator('.help-menu__section-title')).toHaveText('How BITBI works');
    await expect(startSection.locator('.help-menu__items')).toBeHidden();
    await startSection.locator('.help-menu__section-toggle').click();
    await expect(startSection).toHaveAttribute('open', '');

    const accountItem = startSection.locator('.help-menu__item').filter({
      hasText: 'Sign in, create account, reset password',
    });
    await accountItem.locator('.help-menu__item-summary').click();
    await expect(accountItem).toHaveAttribute('open', '');
    await expect(accountItem).toContainText('Account is needed for saving and credits');
    await expect(accountItem.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/account/profile.html?source=help',
    );
    await expect(accountItem.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/account/profile.html?source=help&mode=register',
    );
    await expect(accountItem.getByRole('link', { name: 'Reset password' })).toHaveAttribute(
      'href',
      '/account/forgot-password.html?source=help',
    );
  });

  test('global Help Menu opens from the homepage and carries moved workflow guidance', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#publicMemberJourney')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('From first idea to saved workspace');
    await expect(page.locator('main')).not.toContainText('Create with an account, browse without one');

    const trigger = page.getByRole('button', { name: 'Open help menu' });
    await expect(trigger).toBeVisible();
    const triggerMetrics = await trigger.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const styles = window.getComputedStyle(button);
      return {
        position: styles.position,
        bottomGap: window.innerHeight - rect.bottom,
        rightGap: window.innerWidth - rect.right,
        minSide: Math.min(rect.width, rect.height),
      };
    });
    expect(triggerMetrics.position).toBe('fixed');
    expect(triggerMetrics.bottomGap).toBeGreaterThanOrEqual(8);
    expect(triggerMetrics.rightGap).toBeGreaterThanOrEqual(8);
    expect(triggerMetrics.minSide).toBeGreaterThanOrEqual(44);

    await trigger.click();
    const panel = page.locator('#bitbiHelpPanel');
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const startSection = panel.locator('[data-help-section="start"]');
    await expect(startSection.locator('.help-menu__section-title')).toHaveText('How BITBI works');
    await expect(startSection.locator('.help-menu__items')).toBeHidden();
    await startSection.locator('.help-menu__section-toggle').click();
    await expect(startSection).toHaveAttribute('open', '');
    await expect(startSection).toContainText('Browse public work');
    await expect(startSection).toContainText('Create in Generate Lab');
    const workflowItem = startSection.locator('.help-menu__item').filter({ hasText: 'Create, save, review' });
    await workflowItem.locator('.help-menu__item-summary').click();
    await expect(workflowItem.getByRole('link', { name: 'Open Generate Lab' })).toHaveAttribute(
      'href',
      '/generate-lab/?source=help&step=create',
    );

    const visualState = await panel.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      const bodyStyles = window.getComputedStyle(document.body);
      return {
        backdropFilter: styles.backdropFilter || styles.webkitBackdropFilter || '',
        bodyFilter: bodyStyles.filter || '',
      };
    });
    expect(['', 'none']).toContain(visualState.backdropFilter);
    expect(['', 'none']).toContain(visualState.bodyFilter);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('global Help Menu localizes route-prioritized content on German member routes', async ({ page }) => {
    await page.goto('/de/generate-lab/');

    const trigger = page.getByRole('button', { name: 'Hilfemenü öffnen' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.locator('#bitbiHelpPanel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.help-menu__section-title').first()).toHaveText('Generate Lab');
    const generateSection = panel.locator('[data-help-section="generate"]');
    await expect(generateSection.locator('.help-menu__items')).toBeHidden();
    await generateSection.locator('.help-menu__section-toggle').click();
    await expect(generateSection).toHaveAttribute('open', '');
    const creditsItem = generateSection.locator('.help-menu__item').filter({ hasText: 'Credits vor dem Senden' });
    await creditsItem.locator('.help-menu__item-summary').click();
    await expect(creditsItem.getByRole('link', { name: 'Credits prüfen' })).toHaveAttribute(
      'href',
      '/de/account/credits.html?source=help-generate',
    );
    const firstRunItem = generateSection.locator('.help-menu__item').filter({ hasText: 'Erster Generate-Lab-Lauf' });
    await firstRunItem.locator('.help-menu__item-summary').click();
    await expect(firstRunItem).toContainText('Modell wählen, Prompt schreiben, Schätzung prüfen');
    await expect(firstRunItem).toContainText('Vor Generierung oder Speichern anmelden.');
    await expect(panel.locator('a[href^="/de/admin"]')).toHaveCount(0);
  });

  test('hero section renders', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.locator('#hero');
    const teaser = hero.locator('.hero__lab-teaser');

    await expect(hero).toBeVisible();
    await expect(hero.locator('[data-hero-video]')).toHaveCount(0);
    await expect(hero.locator('.hero__media-video')).toHaveCount(0);
    await expect(hero.getByText('My Digital Playground')).toHaveCount(0);
    await expect(hero.getByRole('heading', { name: 'Start creating from the public site' })).toHaveCount(0);
    await expect(hero).not.toContainText('Open Generate Lab, review credit context before submit');
    await expect(hero).not.toContainText('Backend credit checks');
    await expect(hero).not.toContainText('Saved assets in your workspace');
    await expect(hero).not.toContainText('Compare credits');
    await expect(hero).not.toContainText('Open workspace');
    await expect(hero.locator('a[href="/pricing.html#pricingJourney"]')).toHaveCount(0);
    await expect(hero.locator('a[href="/account/profile.html?source=hero#memberControlCenter"]')).toHaveCount(0);
    await expect(hero.locator('.hero__conversion-link')).toHaveCount(0);
    await expect(hero.locator('.hero__actions')).toHaveClass(/hero__actions--single-cta/);
    await expect(teaser).toBeVisible();
    await expect(teaser.locator('.hero__lab-teaser-text')).toHaveText('Open Generate Lab');
    await expect(teaser.locator('.hero__lab-teaser-badge')).toHaveCount(0);
    await expect(hero.locator('.hero__lab-teaser-icon')).toHaveText('⚗️');
    await expect(teaser).toHaveAttribute('href', '/generate-lab/');
    await expect(teaser).toHaveAttribute('target', 'bitbi-generate-lab');
    await expect(teaser).toHaveAttribute('rel', /noopener/);
    await expect(teaser).toHaveAttribute('rel', /noreferrer/);
    await expect(page.locator('#publicMemberJourney')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('From first idea to saved workspace');
    await expect(page.locator('main')).not.toContainText('Create with an account, browse without one');

    const teaserMetrics = await page.evaluate(() => {
      const teaserEl = document.querySelector('.hero__lab-teaser');
      const textEl = teaserEl?.querySelector('.hero__lab-teaser-text');
      const actionsEl = document.querySelector('.hero__actions');
      const heroEl = document.querySelector('#hero');
      const titleEl = document.querySelector('#hero .hero__title-img');
      const scrollHintEl = document.querySelector('#hero .hero__scroll-hint');
      const navEl = document.querySelector('#navbar');
      const teaserStyle = teaserEl ? window.getComputedStyle(teaserEl) : null;
      const teaserBefore = teaserEl ? window.getComputedStyle(teaserEl, '::before') : null;
      const teaserAfter = teaserEl ? window.getComputedStyle(teaserEl, '::after') : null;
      const scrollHintStyle = scrollHintEl ? window.getComputedStyle(scrollHintEl) : null;
      const teaserRect = teaserEl?.getBoundingClientRect();
      const heroRect = heroEl?.getBoundingClientRect();
      const titleRect = titleEl?.getBoundingClientRect();
      const scrollHintRect = scrollHintEl?.getBoundingClientRect();
      const navRect = navEl?.getBoundingClientRect();
      const modelLabelMetrics = Array.from(document.querySelectorAll('#hero .latest-models-video-module__label'))
        .map((label) => {
          const rect = label.getBoundingClientRect();
          const style = window.getComputedStyle(label);
          return {
            centerY: rect.top + rect.height / 2,
            height: rect.height,
            whiteSpace: style.whiteSpace,
            hyphens: style.hyphens,
            textWrap: style.textWrap,
          };
        });
      const scrollHintTranslateY = scrollHintStyle?.transform && scrollHintStyle.transform !== 'none'
        ? new DOMMatrixReadOnly(scrollHintStyle.transform).m42
        : 0;
      const scrollHintLayoutTop = scrollHintRect ? scrollHintRect.top - scrollHintTranslateY : 0;
      const teaserCenterY = teaserRect ? teaserRect.top + teaserRect.height / 2 : 0;
      return {
        actionClass: actionsEl?.className || '',
        actionJustifyContent: actionsEl ? window.getComputedStyle(actionsEl).justifyContent : '',
        visibleLabel: textEl?.textContent?.trim() || '',
        centerOffset: teaserRect && heroRect
          ? Math.abs((teaserRect.left + teaserRect.width / 2) - (heroRect.left + heroRect.width / 2))
          : Number.POSITIVE_INFINITY,
        titleToTeaserGap: teaserRect && titleRect ? teaserRect.top - titleRect.bottom : 0,
        titleWidth: titleRect?.width || 0,
        titleHeight: titleRect?.height || 0,
        titleCenterOffset: titleRect && heroRect
          ? Math.abs((titleRect.left + titleRect.width / 2) - (heroRect.left + heroRect.width / 2))
          : Number.POSITIVE_INFINITY,
        titleHeaderGap: titleRect && navRect ? titleRect.top - navRect.bottom : 0,
        teaserToScrollGap: teaserRect && scrollHintRect ? scrollHintLayoutTop - teaserRect.bottom : 0,
        modelLabelCenterDelta: modelLabelMetrics.length
          ? Math.max(...modelLabelMetrics.map((label) => Math.abs(label.centerY - teaserCenterY)))
          : Number.POSITIVE_INFINITY,
        modelLabelsSingleLine: modelLabelMetrics.every((label) => label.height < 18),
        modelLabelsNoWrap: modelLabelMetrics.every((label) => label.whiteSpace === 'nowrap'
          && label.hyphens === 'none'
          && label.textWrap === 'nowrap'),
        minBlockSize: teaserStyle ? parseFloat(teaserStyle.minHeight || teaserStyle.minBlockSize || '0') : 0,
        teaserFontSize: teaserStyle ? parseFloat(teaserStyle.fontSize) : 0,
        textTransform: teaserStyle?.textTransform || '',
        boxShadow: teaserStyle?.boxShadow || '',
        borderColor: teaserStyle?.borderColor || '',
        beforeAnimation: teaserBefore?.animationName || '',
        afterAnimation: teaserAfter?.animationName || '',
        pointerEvents: teaserStyle?.pointerEvents || '',
      };
    });

    expect(teaserMetrics.actionClass).toContain('hero__actions--single-cta');
    expect(teaserMetrics.actionJustifyContent).toBe('center');
    expect(teaserMetrics.visibleLabel).toBe('Open Generate Lab');
    expect(teaserMetrics.centerOffset).toBeLessThanOrEqual(2);
    expect(teaserMetrics.titleWidth).toBeGreaterThanOrEqual(660);
    expect(teaserMetrics.titleWidth).toBeLessThanOrEqual(664);
    expect(teaserMetrics.titleHeight).toBeGreaterThan(320);
    expect(teaserMetrics.titleCenterOffset).toBeLessThanOrEqual(2);
    expect(teaserMetrics.titleHeaderGap).toBeGreaterThanOrEqual(0);
    expect(teaserMetrics.titleToTeaserGap).toBeGreaterThanOrEqual(18);
    expect(teaserMetrics.modelLabelCenterDelta).toBeLessThanOrEqual(3);
    expect(teaserMetrics.modelLabelsSingleLine).toBe(true);
    expect(teaserMetrics.modelLabelsNoWrap).toBe(true);
    expect(teaserMetrics.teaserToScrollGap).toBeGreaterThanOrEqual(34);
    expect(teaserMetrics.minBlockSize).toBeGreaterThanOrEqual(56);
    expect(teaserMetrics.teaserFontSize).toBeGreaterThan(13);
    expect(teaserMetrics.textTransform).toBe('none');
    expect(teaserMetrics.boxShadow).not.toBe('none');
    expect(teaserMetrics.borderColor).not.toBe('rgba(255, 255, 255, 0.08)');
    expect(teaserMetrics.beforeAnimation).toContain('heroLabCtaGlow');
    expect(teaserMetrics.afterAnimation).toContain('heroLabCtaSheen');
    expect(teaserMetrics.pointerEvents).not.toBe('none');
  });

  test('homepage hero foreground scales from viewport width and keeps side modules edge-attached', async ({ page }) => {
    await page.route('**/api/public/news-pulse**', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.pathname.includes('/thumbs/')) {
        await route.fulfill({ status: 200, contentType: 'image/webp', body: Buffer.from('mock-thumb') });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: buildNewsPulseItems('hero-scale-pulse'), updated_at: '2026-05-31T08:00:00.000Z' }),
      });
    });

    const stabilizeHeroMeasurement = async () => {
      // Test-only: visual hero animations can shift bounding rects mid-frame in CI.
      await page.addStyleTag({
        content: `
          #hero .hero__scroll-hint {
            animation: none !important;
            transform: translateX(-50%) !important;
            transition: none !important;
          }

          #hero .hero__scroll-hint *,
          #hero .hero__title-wrap,
          #hero .hero__title-img,
          #hero .hero__models-cta,
          #hero .hero__models-cta::before,
          #hero .hero__models-cta::after,
          #hero .hero__creation-stream,
          #hero .hero__creation-stream *,
          #newsPulse,
          #newsPulse * {
            animation: none !important;
            transition: none !important;
          }
        `,
      });
    };

    const waitForStableHeroLayout = async () => {
      await page.evaluate(async () => {
        try {
          await document.fonts?.ready;
        } catch {
          // Font readiness is best-effort in tests.
        }
        const titleImg = document.querySelector('#hero .hero__title-img');
        if (titleImg && !titleImg.complete && typeof titleImg.decode === 'function') {
          await titleImg.decode().catch(() => {});
        }
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    };

    const measureHero = async (width, height, expectScaled) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await stabilizeHeroMeasurement();
      await expect(page.locator('#hero .hero__models-cta')).toHaveCount(2);
      await expect(page.locator('#hero .hero__creation-stream[data-creation-stream-anchored="true"]')).toHaveCount(2);
      await expect
        .poll(() => page.locator('#hero').evaluate((node) => node.dataset.homepageHeroLargeScale || ''), { timeout: 10_000 })
        .toBe(expectScaled ? 'true' : '');
      await expect
        .poll(() => page.locator('#newsPulse').evaluate((node) => node.dataset.newsPulseHeroPlacement || ''), { timeout: 10_000 })
        .toBe('ready');
      await waitForStableHeroLayout();

      return page.evaluate(() => {
        const hero = document.querySelector('#hero');
        const heroRect = hero.getBoundingClientRect();
        const heroStyle = window.getComputedStyle(hero);
        const title = document.querySelector('#hero .hero__title-img').getBoundingClientRect();
        const left = document.querySelector('#hero .hero__models-cta--left').getBoundingClientRect();
        const right = document.querySelector('#hero .hero__models-cta--right').getBoundingClientRect();
        const teaser = document.querySelector('#hero .hero__lab-teaser');
        const teaserRect = teaser.getBoundingClientRect();
        const pulse = document.querySelector('#newsPulse').getBoundingClientRect();
        const scroll = document.querySelector('#hero .hero__scroll-hint').getBoundingClientRect();
        return {
          active: hero.dataset.homepageHeroLargeScale === 'true',
          scale: Number.parseFloat(hero.dataset.homepageHeroScale || '1') || 1,
          verticalScale: Number.parseFloat(hero.dataset.homepageHeroVerticalScale || '1') || 1,
          stageWidth: Number.parseFloat(heroStyle.getPropertyValue('--homepage-hero-stage-width')) || 0,
          stageInlineMargin: Number.parseFloat(heroStyle.getPropertyValue('--homepage-hero-stage-inline-margin')) || 0,
          titleWidth: title.width,
          modelWidth: right.width,
          modelHeight: right.height,
          leftInset: left.left - heroRect.left,
          rightInset: heroRect.right - right.right,
          ctaWidth: teaserRect.width,
          ctaHeight: teaserRect.height,
          ctaHref: teaser.getAttribute('href'),
          ctaTarget: teaser.getAttribute('target'),
          newsWidth: pulse.width,
          newsHeight: pulse.height,
          scrollBottomGap: heroRect.bottom - scroll.bottom,
          anchoredStreams: document.querySelectorAll('#hero .hero__creation-stream[data-creation-stream-anchored="true"]').length,
        };
      });
    };

    const baseline = await measureHero(1728, 1117, false);
    const shortDesktop = await measureHero(1920, 1080, true);
    const large = await measureHero(2560, 1440, true);
    const fourK = await measureHero(3840, 2160, true);
    const expectedShortScale = 1920 / 1728;
    const expectedLargeScale = 2560 / 1728;
    const expectedLargeVerticalScale = 1440 / 1117;
    const expectedFourKScale = 3840 / 1728;

    expect(baseline.active).toBe(false);
    expect(shortDesktop.active).toBe(true);
    expect(large.active).toBe(true);
    expect(fourK.active).toBe(true);
    expectWithinPx(shortDesktop.scale, expectedShortScale, 'short desktop width-fill scale', 0.01);
    expectWithinPx(large.scale, expectedLargeScale, 'large hero scale', 0.01);
    expectWithinPx(large.verticalScale, expectedLargeVerticalScale, 'large vertical safety scale', 0.01);
    expectWithinPx(large.titleWidth / baseline.titleWidth, large.scale, 'title scale ratio', 0.04);
    expectWithinPx(large.modelWidth / baseline.modelWidth, large.scale, 'model width scale ratio', 0.04);
    expectWithinPx(large.modelHeight / baseline.modelHeight, large.scale, 'model height scale ratio', 0.04);
    expect(large.ctaWidth).toBeGreaterThan(baseline.ctaWidth * 1.2);
    expect(large.ctaHeight).toBeGreaterThan(baseline.ctaHeight * 1.2);
    expect(large.newsWidth).toBeGreaterThan(baseline.newsWidth * 1.2);
    expect(large.newsHeight).toBeGreaterThan(baseline.newsHeight * 1.15);
    expectWithinPx(large.stageInlineMargin, 0, 'large stage inline margin', 0.5);
    expectWithinPx(large.stageWidth, 2560, 'large stage width fills viewport', 1);
    expectWithinPx(large.leftInset, 0, 'left model remains edge-attached', 2);
    expectWithinPx(large.rightInset, 0, 'right model remains edge-attached', 2);
    expect(large.ctaHref).toBe('/generate-lab/');
    expect(large.ctaTarget).toBe('bitbi-generate-lab');
    expect(large.anchoredStreams).toBe(2);
    expect(large.scrollBottomGap).toBeGreaterThan(baseline.scrollBottomGap);
    expect(shortDesktop.modelWidth).toBeGreaterThan(0);
    expectWithinPx(shortDesktop.modelWidth / baseline.modelWidth, expectedShortScale, 'short desktop model width scale', 0.04);
    expectWithinPx(shortDesktop.leftInset, 0, 'short desktop left edge attachment', 2);
    expectWithinPx(shortDesktop.rightInset, 0, 'short desktop right edge attachment', 2);
    expectWithinPx(fourK.scale, expectedFourKScale, '4k width-fill scale', 0.01);
    expect(fourK.modelWidth).toBeGreaterThan(large.modelWidth);
    expect(fourK.newsWidth).toBeGreaterThan(large.newsWidth);
    expectWithinPx(fourK.leftInset, 0, '4k left edge attachment', 2);
    expectWithinPx(fourK.rightInset, 0, '4k right edge attachment', 2);
  });

  test('hero creation stream origins and endpoints stay anchored to CTA and Models module', async ({ page }) => {
    await page.route('**/api/public/news-pulse**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], updated_at: '2026-05-27T08:00:00.000Z' }),
      });
    });

    const measureStreamAnchors = async (side) => {
      await expect(page.locator('#hero .hero__creation-stream[data-creation-stream-anchored="true"]')).toHaveCount(2);
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      return page.evaluate((side) => {
        const tolerance = 2;
        const teaser = document.querySelector('#hero .hero__lab-teaser');
        const actions = document.querySelector('#hero .hero__actions--single-cta');
        const stream = document.querySelector(`#hero .hero__creation-stream[data-creation-stream-side="${side}"]`);
        const module = document.querySelector(`#hero .latest-models-video-module[data-latest-models-video-module-side="${side}"]`);
        const topSlot = module?.querySelector('[data-latest-models-slot="top"]');
        const bottomSlot = module?.querySelector('[data-latest-models-slot="bottom"]');
        const edgeGlowPath = module?.querySelector('.latest-models-video-module__edge-glow-path--core');
        const haloLayer = stream?.querySelector('.hero__creation-stream-layer--halo');
        const haloPaths = Array.from(stream?.querySelectorAll('.hero__creation-stream-halo') || []);
        const strandPaths = Array.from(stream?.querySelectorAll('.hero__creation-stream-strand') || []);
        const highlightPaths = Array.from(stream?.querySelectorAll('.hero__creation-stream-highlight') || []);
        const paths = [...haloPaths, ...strandPaths, ...highlightPaths];
        const particleLayer = stream?.querySelector('.hero__creation-stream-layer--particles');
        const particles = Array.from(stream?.querySelectorAll('.hero__creation-stream-layer--particles .hero__creation-stream-particle') || []);
        const flares = Array.from(stream?.querySelectorAll('.hero__creation-stream-flare') || []);
        const flareRays = Array.from(stream?.querySelectorAll('.hero__creation-stream-flare-ray') || []);
        const flare = stream?.querySelector('.hero__creation-stream-flare--origin');
        const topFlare = stream?.querySelector('.hero__creation-stream-flare--top');
        const bottomFlare = stream?.querySelector('.hero__creation-stream-flare--bottom');
        const teaserRect = teaser?.getBoundingClientRect();
        const topSlotRect = topSlot?.getBoundingClientRect();
        const bottomSlotRect = bottomSlot?.getBoundingClientRect();
        const videoRect = topSlotRect && bottomSlotRect
          ? {
            left: Math.min(topSlotRect.left, bottomSlotRect.left),
            right: Math.max(topSlotRect.right, bottomSlotRect.right),
            top: Math.min(topSlotRect.top, bottomSlotRect.top),
            bottom: Math.max(topSlotRect.bottom, bottomSlotRect.bottom),
            width: Math.max(topSlotRect.right, bottomSlotRect.right) - Math.min(topSlotRect.left, bottomSlotRect.left),
            height: Math.max(topSlotRect.bottom, bottomSlotRect.bottom) - Math.min(topSlotRect.top, bottomSlotRect.top),
          }
          : null;
        const streamStyle = stream ? window.getComputedStyle(stream) : null;
        const actionsStyle = actions ? window.getComputedStyle(actions) : null;
        const haloLayerStyle = haloLayer ? window.getComputedStyle(haloLayer) : null;
        const particleLayerStyle = particleLayer ? window.getComputedStyle(particleLayer) : null;

        const toScreenPoint = (element, point) => {
          const matrix = element.getScreenCTM?.();
          if (!matrix) return null;
          return new DOMPoint(point.x, point.y).matrixTransform(matrix);
        };

        const getNearestEdgeGlowPoint = (screenY) => {
          if (!edgeGlowPath || !Number.isFinite(screenY)) return null;

          let length = 0;
          try {
            length = edgeGlowPath.getTotalLength();
          } catch {
            return null;
          }

          if (!Number.isFinite(length) || length <= 0) return null;

          let nearest = null;
          let nearestDistance = Number.POSITIVE_INFINITY;
          const samples = 128;
          for (let index = 0; index <= samples; index += 1) {
            const point = toScreenPoint(edgeGlowPath, edgeGlowPath.getPointAtLength((length * index) / samples));
            if (!point) continue;
            const distance = Math.abs(point.y - screenY);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearest = point;
            }
          }

          return nearest;
        };

        const pointInsideTeaser = (point) => Boolean(teaserRect && point
          && point.x >= teaserRect.left - tolerance
          && point.x <= teaserRect.right + tolerance
          && point.y >= teaserRect.top - tolerance
          && point.y <= teaserRect.bottom + tolerance);

        const pathFailures = paths.map((path) => {
          const start = path.getPointAtLength(0);
          const screenPoint = toScreenPoint(path, start);
          return {
            className: path.getAttribute('class') || '',
            x: screenPoint ? Math.round(screenPoint.x * 100) / 100 : null,
            y: screenPoint ? Math.round(screenPoint.y * 100) / 100 : null,
            inside: pointInsideTeaser(screenPoint),
          };
        }).filter((entry) => !entry.inside);

        const endpoints = paths.map((path) => {
          const end = path.getPointAtLength(path.getTotalLength());
          const screenPoint = toScreenPoint(path, end);
          const y = screenPoint?.y ?? null;
          const x = screenPoint?.x ?? null;
          const nearestEdgePoint = getNearestEdgeGlowPoint(y);
          const edgeGlowDelta = screenPoint && nearestEdgePoint
            ? Math.hypot(screenPoint.x - nearestEdgePoint.x, screenPoint.y - nearestEdgePoint.y)
            : null;
          const insideVideoY = Boolean(videoRect && screenPoint
            && y >= videoRect.top - tolerance
            && y <= videoRect.bottom + tolerance);
          const nearVideoEdge = side === 'left'
            ? Boolean(videoRect && screenPoint
              && x >= videoRect.right - (videoRect.width * 0.42)
              && x <= videoRect.right + 12)
            : Boolean(videoRect && screenPoint
              && x >= videoRect.left - 12
              && x <= videoRect.left + (videoRect.width * 0.42));
          const onEdgeGlowRail = edgeGlowDelta !== null && edgeGlowDelta <= 8;

          return {
            className: path.getAttribute('class') || '',
            x: x === null ? null : Math.round(x * 100) / 100,
            y: y === null ? null : Math.round(y * 100) / 100,
            edgeGlowDelta: edgeGlowDelta === null ? null : Math.round(edgeGlowDelta * 100) / 100,
            insideVideoY,
            nearVideoEdge,
            onEdgeGlowRail,
          };
        });
        const endpointFailures = endpoints.filter((entry) => (
          !entry.insideVideoY || !entry.nearVideoEdge || !entry.onEdgeGlowRail
        ));
        const endpointYs = endpoints
          .map((entry) => entry.y)
          .filter((value) => Number.isFinite(value));
        const endpointSpread = endpointYs.length
          ? Math.max(...endpointYs) - Math.min(...endpointYs)
          : 0;
        const midpoint = videoRect ? videoRect.top + (videoRect.height * 0.5) : 0;
        const upperEndpointCount = endpoints.filter((entry) => Number.isFinite(entry.y) && entry.y < midpoint).length;
        const lowerEndpointCount = endpoints.filter((entry) => Number.isFinite(entry.y) && entry.y >= midpoint).length;
        const getTurnAngle = (a, b, c) => {
          const first = { x: b.x - a.x, y: b.y - a.y };
          const second = { x: c.x - b.x, y: c.y - b.y };
          const firstLength = Math.hypot(first.x, first.y);
          const secondLength = Math.hypot(second.x, second.y);
          if (!firstLength || !secondLength) return 0;
          const cosine = Math.min(1, Math.max(-1, (
            (first.x * second.x) + (first.y * second.y)
          ) / (firstLength * secondLength)));
          return Math.acos(cosine) * (180 / Math.PI);
        };
        const smoothnessFailures = paths.map((path) => {
          const length = path.getTotalLength();
          const points = [0.62, 0.7, 0.78, 0.86, 0.94, 1]
            .map((ratio) => toScreenPoint(path, path.getPointAtLength(length * ratio)))
            .filter(Boolean);
          const angles = points.slice(1, -1).map((point, index) => (
            getTurnAngle(points[index], point, points[index + 2])
          ));
          const maxTurn = angles.length ? Math.max(...angles) : 0;
          return {
            className: path.getAttribute('class') || '',
            maxTurn: Math.round(maxTurn * 100) / 100,
          };
        }).filter((entry) => entry.maxTurn > 82);
        const parseNumberList = (value) => (
          (value.match(/-?\d+(?:\.\d+)?/g) || []).map((part) => Number.parseFloat(part))
        );
        const getHighlightKey = (path) => {
          const className = path.getAttribute('class') || '';
          const variant = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']
            .find((key) => className.includes(`hero__creation-stream-highlight--${key}`));
          return variant || 'base';
        };
        const highlightMetrics = Object.fromEntries(highlightPaths.map((path) => {
          const style = window.getComputedStyle(path);
          return [
            getHighlightKey(path),
            {
              animationDuration: Number.parseFloat(style.animationDuration || '0'),
              animationName: style.animationName || '',
              display: style.display || '',
              opacity: Number.parseFloat(style.opacity || '0'),
              strokeDasharray: parseNumberList(style.strokeDasharray || ''),
            },
          ];
        }));
        const haloMetrics = haloPaths.map((path) => {
          const style = window.getComputedStyle(path);
          return {
            className: path.getAttribute('class') || '',
            strokeWidth: Number.parseFloat(style.strokeWidth || '0'),
            opacity: Number.parseFloat(style.opacity || '0'),
            animationName: style.animationName || '',
          };
        });
        const visibleParticleCount = particles.filter((particle) => {
          const style = window.getComputedStyle(particle);
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number.parseFloat(style.opacity || '1') > 0;
        }).length;
        const visibleFlareRayCount = flareRays.filter((ray) => {
          const style = window.getComputedStyle(ray);
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number.parseFloat(style.opacity || '1') > 0;
        }).length;
        const particleDurations = particles.flatMap((particle) => (
          window.getComputedStyle(particle).animationDuration
            .split(',')
            .map((duration) => Number.parseFloat(duration))
            .filter(Number.isFinite)
        ));

        const flarePoint = flare
          ? toScreenPoint(flare, {
            x: flare.cx.baseVal.value,
            y: flare.cy.baseVal.value,
          })
          : null;
        const topFlarePoint = topFlare
          ? toScreenPoint(topFlare, {
            x: topFlare.cx.baseVal.value,
            y: topFlare.cy.baseVal.value,
          })
          : null;
        const bottomFlarePoint = bottomFlare
          ? toScreenPoint(bottomFlare, {
            x: bottomFlare.cx.baseVal.value,
            y: bottomFlare.cy.baseVal.value,
          })
          : null;
        const flareNearVideoEdge = (point) => {
          if (!videoRect || !point) return false;
          const nearX = side === 'left'
            ? point.x >= videoRect.right - (videoRect.width * 0.42) && point.x <= videoRect.right + 12
            : point.x >= videoRect.left - 12 && point.x <= videoRect.left + (videoRect.width * 0.42);
          return nearX
            && point.y >= videoRect.top - tolerance
            && point.y <= videoRect.bottom + tolerance;
        };

        return {
          side,
          width: window.innerWidth,
          streamPointerEvents: streamStyle?.pointerEvents || '',
          streamZIndex: Number.parseInt(streamStyle?.zIndex || '0', 10),
          actionsPosition: actionsStyle?.position || '',
          actionsZIndex: Number.parseInt(actionsStyle?.zIndex || '0', 10),
          pathCount: paths.length,
          haloPathCount: haloPaths.length,
          strandPathCount: strandPaths.length,
          highlightPathCount: highlightPaths.length,
          haloLayerFilter: haloLayerStyle?.filter || '',
          haloMetrics,
          flareCount: flares.length,
          particleCount: particles.length,
          visibleParticleCount,
          visibleHighlightCount: highlightPaths.filter((path) => {
            const style = window.getComputedStyle(path);
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.animationName === 'heroCreationStreamFlow'
              && Number.parseFloat(style.opacity || '0') > 0;
          }).length,
          flareRayCount: flareRays.length,
          visibleFlareRayCount,
          particleLayerDisplay: particleLayerStyle?.display || '',
          highlightMetrics,
          maxParticleAnimationDuration: particleDurations.length
            ? Math.max(...particleDurations)
            : 0,
          minParticleAnimationDuration: particleDurations.length
            ? Math.min(...particleDurations)
            : 0,
          pathFailures,
          flareInside: pointInsideTeaser(flarePoint),
          endpointFailures,
          endpointSpread,
          expectedEndpointSpread: videoRect ? videoRect.height * 0.48 : 0,
          upperEndpointCount,
          lowerEndpointCount,
          smoothnessFailures,
          topFlareNearVideoEdge: flareNearVideoEdge(topFlarePoint),
          bottomFlareNearVideoEdge: flareNearVideoEdge(bottomFlarePoint),
        };
      }, side);
    };

    for (const path of ['/', '/de/']) {
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#hero .hero__creation-stream')).toHaveCount(2);

      const expectedHighlightMetrics = {
        one: { active: true, animationDuration: 2.4167, strokeDasharray: [20, 9999] },
        two: { active: true, animationDuration: 2.7917, strokeDasharray: [18, 9999] },
        three: { active: true, animationDuration: 2.125, strokeDasharray: [18, 9999] },
        four: { active: false, strokeDasharray: [15, 9999] },
        five: { active: true, animationDuration: 2.5417, strokeDasharray: [16, 9999] },
        six: { active: false, strokeDasharray: [15, 9999] },
        seven: { active: true, animationDuration: 3.5, strokeDasharray: [14, 9999] },
      };

      for (const width of [1100, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        for (const side of ['right', 'left']) {
          const metrics = await measureStreamAnchors(side);
          const context = `${path} ${side} stream at ${width}px`;

          expect(metrics.streamPointerEvents, `stream pointer events for ${context}`).toBe('none');
          expect(metrics.actionsPosition, `CTA action stacking for ${context}`).toBe('relative');
          expect(metrics.actionsZIndex, `CTA action z-index for ${context}`).toBeGreaterThan(metrics.streamZIndex);
          expect(metrics.pathCount, `stream path count for ${context}`).toBeGreaterThan(20);
          expect(metrics.haloPathCount, `stream halo path count for ${context}`).toBe(4);
          expect(metrics.strandPathCount, `stream strand path count for ${context}`).toBe(15);
          expect(metrics.highlightPathCount, `stream highlight path count for ${context}`).toBe(7);
          expect(metrics.visibleHighlightCount, `moving stream highlight count for ${context}`).toBe(5);
          expect(metrics.haloLayerFilter, `stream halo filter for ${context}`).toBe('none');
          for (const halo of metrics.haloMetrics) {
            expect(halo.strokeWidth, `slim halo stroke for ${context} ${halo.className}`).toBeLessThanOrEqual(3.5);
            expect(halo.opacity, `subtle halo opacity for ${context} ${halo.className}`).toBeLessThanOrEqual(0.08);
            expect(halo.animationName, `halo animation disabled for ${context} ${halo.className}`).toBe('none');
          }
          expect(metrics.flareCount, `stream flare count for ${context}`).toBe(3);
          expect(metrics.particleLayerDisplay, `stream particles visible for ${context}`).toBe('none');
          expect(metrics.visibleParticleCount, `stream visible particle count for ${context}`).toBe(0);
          expect(metrics.visibleFlareRayCount, `stream visible flare-ray count for ${context}`).toBe(0);
          for (const [variant, expected] of Object.entries(expectedHighlightMetrics)) {
            const actual = metrics.highlightMetrics[variant];
            expect(actual, `stream highlight ${variant} metrics for ${context}`).toBeTruthy();
            if (expected.active) {
              expect(actual.display, `stream highlight ${variant} display for ${context}`).not.toBe('none');
              expect(actual.animationName, `stream highlight ${variant} animation for ${context}`).toBe('heroCreationStreamFlow');
              expect(actual.opacity, `stream highlight ${variant} opacity for ${context}`).toBeGreaterThan(0);
              expect(
                actual.animationDuration,
                `stream highlight ${variant} duration for ${context}`,
              ).toBeCloseTo(expected.animationDuration, 2);
            } else {
              expect(actual.display, `disabled stream highlight ${variant} display for ${context}`).toBe('none');
              expect(actual.animationName, `disabled stream highlight ${variant} animation for ${context}`).toBe('none');
              expect(actual.opacity, `disabled stream highlight ${variant} opacity for ${context}`).toBe(0);
            }
            expect(
              actual.strokeDasharray.slice(0, 2),
              `stream highlight ${variant} dasharray for ${context}`,
            ).toEqual(expected.strokeDasharray);
          }
          expect(metrics.pathFailures, `stream path starts outside CTA for ${context}`).toEqual([]);
          expect(metrics.flareInside, `stream origin flare outside CTA for ${context}`).toBe(true);
          expect(metrics.endpointFailures, `stream endpoints away from Models edge for ${context}`).toEqual([]);
          expect(metrics.endpointSpread, `stream endpoint spread for ${context}`).toBeGreaterThan(metrics.expectedEndpointSpread);
          expect(metrics.upperEndpointCount, `upper stream endpoints for ${context}`).toBeGreaterThan(8);
          expect(metrics.lowerEndpointCount, `lower stream endpoints for ${context}`).toBeGreaterThan(8);
          expect(metrics.smoothnessFailures, `stream final-third kink for ${context}`).toEqual([]);
          expect(metrics.topFlareNearVideoEdge, `top stream flare away from Models edge for ${context}`).toBe(true);
          expect(metrics.bottomFlareNearVideoEdge, `bottom stream flare away from Models edge for ${context}`).toBe(true);
        }
      }
    }
  });

  test('hero falls back cleanly in reduced motion mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const hero = page.locator('#hero');
    const teaser = hero.locator('.hero__lab-teaser');

    await expect(hero).toBeVisible();
    await expect(hero.locator('[data-hero-video]')).toHaveCount(0);
    await expect(hero.getByRole('heading', { name: 'Start creating from the public site' })).toHaveCount(0);
    await expect(teaser).toBeVisible();
    await expect(teaser.locator('.hero__lab-teaser-text')).toHaveText('Open Generate Lab');
    await expect(teaser.locator('.hero__lab-teaser-badge')).toHaveCount(0);
    await expect(teaser).toHaveAttribute('href', '/generate-lab/');
    await expect(teaser).toHaveAttribute('target', 'bitbi-generate-lab');
    await expect(teaser).toHaveAttribute('rel', /noopener/);
    await expect(teaser).toHaveAttribute('rel', /noreferrer/);

    const reducedMotionCta = await teaser.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const before = window.getComputedStyle(node, '::before');
      const after = window.getComputedStyle(node, '::after');
      return {
        transitionDuration: style.transitionDuration,
        transform: style.transform,
        beforeAnimation: before.animationName,
        afterAnimation: after.animationName,
      };
    });
    expect(Number.parseFloat(reducedMotionCta.transitionDuration)).toBeLessThanOrEqual(0.00001);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(reducedMotionCta.transform);
    expect(reducedMotionCta.beforeAnimation).toBe('none');
    expect(reducedMotionCta.afterAnimation).toBe('none');
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
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Creation Workspace');
    await expect(page.locator('header .site-nav__mood')).toBeVisible();
    await expect(page.locator('header .locale-switcher__link[hreflang="de"]')).toHaveAttribute('href', '/de/generate-lab/');
    await expect(page.locator('#labAssetsOpen')).toBeVisible();
    await expect(page.locator('header .auth-nav__logout')).toHaveText('Sign Out');
    await expect.poll(() => readHeaderActionOrder(page)).toEqual(expect.arrayContaining(['panel', 'locale', 'auth']));
    {
      const order = await readHeaderActionOrder(page);
      expect(order.indexOf('panel'), `Generate Lab header order ${order.join(' > ')}`).toBeLessThan(order.indexOf('locale'));
    }
    await expectGenerateLabHeaderAligned(page, { locale: 'English' });

    await page.evaluate(() => { window.__generateLabBrandMarker = 'still-here'; });
    await page.locator('header .site-nav__logo').click();
    await expectPathUnchanged(page, '/generate-lab/');
    await expect.poll(() => page.evaluate(() => window.__generateLabBrandMarker)).toBe('still-here');

    await markLogoutReloadProbe(page);
    await page.locator('header .auth-nav__logout').click();
    await expect.poll(() => session.getLogoutRequests()).toBe(1);
    await expectLogoutHardReload(page);
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
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Erstellungsbereich');
    await expect(page.locator('header .site-nav__mood')).toBeVisible();
    await expect(page.locator('header .locale-switcher__link[hreflang="en"]')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#labAssetsOpen')).toBeVisible();
    await expect(page.locator('header .auth-nav__logout')).toHaveText('Abmelden');
    await expect.poll(() => readHeaderActionOrder(page)).toEqual(expect.arrayContaining(['panel', 'locale', 'auth']));
    {
      const order = await readHeaderActionOrder(page);
      expect(order.indexOf('panel'), `Generate Lab header order ${order.join(' > ')}`).toBeLessThan(order.indexOf('locale'));
    }
    await expectGenerateLabHeaderAligned(page, { locale: 'German' });

    await page.evaluate(() => { window.__generateLabBrandMarker = 'still-here'; });
    await page.locator('header .site-nav__logo').click();
    await expectPathUnchanged(page, '/de/generate-lab/');
    await expect.poll(() => page.evaluate(() => window.__generateLabBrandMarker)).toBe('still-here');

    await markLogoutReloadProbe(page);
    await page.locator('header .auth-nav__logout').click();
    await expect.poll(() => session.getLogoutRequests()).toBe(1);
    await expectLogoutHardReload(page);
    await expect(page.locator('header .site-nav__cta')).toHaveText('Anmelden');
  });

  test('Generate Lab signed-out generation opens the account modal with guidance', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.goto('/generate-lab/');

    await expect(page.locator('.generate-lab__account-needed')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Sign in before generation or saving');
    await expect(page.locator('main')).not.toContainText('generation, saving, recent assets, and final credit checks require your BITBI account');
    await expect(page.locator('#authModal .auth-modal__overlay')).toHaveCount(1);

    await page.locator('#labGenerate').click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('.auth-modal__tab.active')).toHaveText('Create Account');
    await expect(page.locator('#authRegisterMsg')).toContainText(
      'Create or sign in to a BITBI account before generating, saving, or loading recent assets.',
    );
    await expectAuthContextRemoved(page);
    await expect(page.locator('#authRegisterForm input[name="email"]')).toBeVisible();
    await page.locator('.auth-modal__tab[data-tab="login"]').click();
    await expect(page.locator('#authLoginForm input[name="email"]')).toBeVisible();
    await expect(page.locator('#authLoginForm a[href="/account/forgot-password.html"]')).toHaveText('Forgot password?');
  });

  test('Generate Lab strips unsafe return context without rendering workspace hint panels', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockGenerateLabMemberSession(page, {
      email: 'post-auth-lab@bitbi.ai',
      userId: 'post-auth-lab-member',
      credits: 77,
    });

    await page.goto('/generate-lab/?source=profile&returnTo=https%3A%2F%2Fevil.example%2Flab%3Ftoken%3Draw-lab&token=raw-lab');

    await expect(page.locator('[data-auth-post-hint]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('You are signed in to Generate Lab');
    await expect(page.locator('main')).not.toContainText('Opened from Profile.');
    await expect(page.locator('main')).not.toContainText('raw return URLs');
    expect(page.url()).not.toContain('returnTo=');
    expect(page.url()).not.toContain('raw-lab');

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);
  });

  test('Generate Lab shows session-expired recovery after account API failure', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'raw generate session detail' }),
      });
    });

    await page.goto('/generate-lab/');

    await expect(page.locator('#labAccountStatus')).toContainText('Session expired. Sign in again.');
    await expect(page.locator('#labCreditStatus')).toContainText('Your prompt stays on this page.');
    await expect(page.locator('#labCostInsight')).toBeHidden();
    await expect(page.locator('#labMessage')).toContainText('Your prompt stays on this page.');
    await expect(page.locator('#labMessage')).not.toContainText('raw generate');

    await page.locator('#labGenerate').click();
    await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
    await expect(page.locator('.auth-modal__tab.active')).toHaveText('Sign In');
    await expect(page.locator('#authLoginMsg')).toContainText('Sign in again before generating, saving, or loading recent assets.');
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
    await expect(page.getByRole('heading', { name: 'Generate Lab' })).toHaveCount(0);
    await expect(page.locator('.generate-lab__topbar')).toHaveCount(0);
    await expect(page.locator('.generate-lab__subtitle')).toHaveCount(0);
    await expect(page.locator('.generate-lab__composer-flow')).toHaveCount(0);
    await expect(page.locator('#labCreditsLink')).toHaveCount(0);
    await expect(page.locator('.generate-lab__member-nav')).toHaveCount(0);
    await expect(page.locator('#generateWorkspacePriority')).toHaveCount(0);
    await expect(page.locator('.generate-lab__session-panel')).toHaveCount(0);
    await expect(page.locator('.generate-lab__account-needed')).toHaveCount(0);
    await expect(page.locator('.generate-lab__first-run')).toHaveCount(0);
    await expect(workspace).not.toContainText('Member workspace');
    await expect(workspace).not.toContainText('Workspace priority');
    await expect(workspace).not.toContainText('Account session');
    await expect(workspace).not.toContainText('Account needed');
    await expect(workspace).not.toContainText('First time here?');
    await expect(workspace).not.toContainText('Create images, videos, and music with BITBI');
    await expect(workspace).not.toContainText('Write or refine the idea here.');
    await expect(workspace).not.toContainText('Backend validation confirms final credits.');
    await expect(workspace).not.toContainText('The result stays visible after save errors.');
    await expect(workspace).not.toContainText('Saved output opens from Assets Manager.');
    await expect(workspace).not.toContainText('Ready to configure');
    await expect(workspace).not.toContainText('Pick a model, review estimated credits, then generate.');
    await expect(workspace).not.toContainText('Review credits');
    await expect(workspace).not.toContainText('Images remain in preview until you save them.');
    await expect(workspace).not.toContainText('Show all saved');
    await expect(page.locator('header').getByRole('link', { name: 'Gallery' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Video' })).toHaveCount(0);
    await expect(page.locator('header').getByRole('link', { name: 'Sound Lab' })).toHaveCount(0);
    await expect(page.locator('header .site-nav__logo')).not.toHaveAttribute('href', /./);
    await expect(page.locator('header .site-nav__logo')).not.toHaveAttribute('target', /./);
    await expect(page.locator('header .site-nav__logo')).not.toHaveAttribute('rel', /./);
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Creation Workspace');
    await expect(page.locator('header')).not.toContainText(['Generate Lab', 'is', 'Creation Workspace'].join(' '));
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
    await expect(page.locator('#labWorkflowStatus')).toBeHidden();
    await expect(page.locator('#labCostInsight')).toBeHidden();
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
    await expect(page.locator('#labModelList').getByText('FLUX.2 Max')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('GPT Image 2')).toBeVisible();
    await expect(page.locator('#labImageModel option')).toHaveText([
      'FLUX.1 Schnell',
      'FLUX.2 Klein 9B',
      'FLUX.2 Max',
      'GPT Image 2',
    ]);
    await expectLabAccent('192, 38, 211', '0, 240, 255');

    await page.selectOption('#labImageModel', 'openai/gpt-image-2');
    await expect(page.locator('#labImageGptControls')).toBeVisible();
    await expect(page.locator('#labImageFluxControls')).toBeHidden();
    await expect(page.locator('#labImageQuality')).toBeVisible();
    await expect(page.locator('#labImageSize')).toBeVisible();
    await expect(page.locator('#labImageOutputFormat')).toBeVisible();
    await expect(page.locator('#labImageBackground')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('50 credits');
    await expect(page.locator('#labCostInsight')).toBeHidden();
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
    await expect(page.locator('#labCostInsight')).toBeHidden();
    await expect(page.locator('#labImageAutoCostHint')).toBeVisible();
    await page.selectOption('#labImageModel', 'black-forest-labs/flux-2-max');
    await expect(page.locator('#labImageFluxControls')).toBeVisible();
    await expect(page.locator('#labImageGptControls')).toBeVisible();
    await expect(page.locator('label:has(#labImageSteps)')).toBeHidden();
    await expect(page.locator('label:has(#labImageSeed)')).toBeVisible();
    await expect(page.locator('label:has(#labImageWidth)')).toBeVisible();
    await expect(page.locator('label:has(#labImageHeight)')).toBeVisible();
    await expect(page.locator('label:has(#labImageSafetyTolerance)')).toBeVisible();
    await expect(page.locator('label:has(#labImageQuality)')).toBeHidden();
    await expect(page.locator('label:has(#labImageSize)')).toBeHidden();
    await expect(page.locator('label:has(#labImageBackground)')).toBeHidden();
    await expect(page.locator('label:has(#labImageOutputFormat)')).toBeVisible();
    await expect(page.locator('#labImageWidth')).toHaveValue('1024');
    await expect(page.locator('#labImageHeight')).toHaveValue('1024');
    await expect(page.locator('#labImageOutputFormat')).toHaveValue('jpeg');
    await expect(page.locator('#labImageSafetyTolerance')).toHaveValue('2');
    await expect(page.locator('#labImageRefPrimary .generate-lab-ref-images__slot')).toHaveCount(3);
    await expect(page.locator('#labImageRefExtraGrid .generate-lab-ref-images__slot')).toHaveCount(5);
    await expect(page.locator('#labImageReferenceCount')).toHaveText('1 / 8');
    await expect(page.locator('#labCost')).toHaveText('46 credits');
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

    await page.getByRole('tab', { name: 'Video' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-lab-mode', 'video');
    await expectLabAccent('0, 240, 255', '255, 179, 0');
    await expect(page.locator('#labWorkflowStatus')).toBeHidden();
    await expect(workspace).not.toContainText('Video remains in preview until you save it.');
    await expect(page.locator('#labModelList').getByText('PixVerse V6')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('HappyHorse 1.0 T2V')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('Seedance 2.0 Fast')).toBeVisible();
    await expect(page.locator('#labModelList').getByText('Grok Imagine Video')).toBeVisible();
    await expect(page.getByLabel('Describe your video')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('185 credits');
    await expect(page.getByText('Vidu Q3 Pro')).toHaveCount(0);
    await expect(page.getByText('Seedance 2.0', { exact: true })).toHaveCount(0);

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

    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'Seedance 2.0 Fast' }).click();
    await expect(page.locator('#labCost')).toHaveText('252 credits');
    await expect(page.locator('#labVideoNegativeField')).toBeHidden();
    await expect(page.locator('#labVideoReferenceField')).toBeHidden();
    await expect(page.locator('#labVideoAudioField')).toBeHidden();
    await expect(page.locator('#labVideoWatermarkField')).toBeHidden();
    await expect(page.locator('label:has(#labVideoSeed)')).toBeHidden();
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Resolution');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Aspect');
    await expect(page.locator('#labVideoDuration option')).toHaveText([
      '4 s',
      '5 s',
      '6 s',
      '7 s',
      '8 s',
      '9 s',
      '10 s',
      '11 s',
      '12 s',
    ]);
    await expect(page.locator('#labVideoDuration option[value="15"]')).toHaveCount(0);
    await expect(page.locator('#labVideoQuality option')).toHaveText(['480p', '720p']);
    await expect(page.locator('#labVideoQuality option[value="1080p"]')).toHaveCount(0);
    await expect(page.locator('#labVideoAspect option')).toHaveText(['16:9', '9:16', '1:1', '4:3', '3:4']);
    await page.selectOption('#labVideoQuality', '480p');
    await expect(page.locator('#labCost')).toHaveText('252 credits');
    await page.selectOption('#labVideoQuality', '720p');
    await expect(page.locator('#labCost')).toHaveText('252 credits');
    await page.selectOption('#labVideoDuration', '12');
    await expect(page.locator('#labCost')).toHaveText('604 credits');

    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'Grok Imagine Video' }).click();
    await expect(page.locator('#labCost')).toHaveText('164 credits');
    await expect(page.locator('#labVideoNegativeField')).toBeHidden();
    await expect(page.locator('#labVideoReferenceField')).toBeHidden();
    await expect(page.locator('#labVideoAudioField')).toBeHidden();
    await expect(page.locator('#labVideoWatermarkField')).toBeHidden();
    await expect(page.locator('label:has(#labVideoSeed)')).toBeHidden();
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Resolution');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Aspect');
    await expect(page.locator('#labVideoDuration option').first()).toHaveAttribute('value', '1');
    await expect(page.locator('#labVideoDuration option[value="15"]')).toHaveCount(1);
    await expect(page.locator('#labVideoQuality option')).toHaveText(['480p', '720p']);
    await expect(page.locator('#labVideoAspect option')).toHaveText(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
    await page.selectOption('#labVideoDuration', '10');
    await expect(page.locator('#labCost')).toHaveText('328 credits');

    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'PixVerse V6' }).click();
    await expect(page.locator('#labCost')).toHaveText('185 credits');
    await expect(page.locator('#labVideoNegativeField')).toBeVisible();
    await expect(page.locator('#labVideoReferenceField')).toBeVisible();
    await expect(page.locator('#labVideoAudioField')).toBeVisible();
    await expect(page.locator('#labVideoWatermarkField')).toBeHidden();
    await expect(page.locator('label:has(#labVideoSeed)')).toBeVisible();
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Quality');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Aspect');

    await page.getByRole('tab', { name: 'Music' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-lab-mode', 'music');
    await expectLabAccent('255, 179, 0', '0, 240, 255');
    await expect(page.locator('#labWorkflowStatus')).toBeHidden();
    await expect(workspace).not.toContainText('Music remains in preview until you save it.');
    await expect(page.locator('#labModelList').getByText('MiniMax Music 2.6')).toBeVisible();
    await expect(page.getByLabel('Describe your track')).toBeVisible();
    await expect(page.locator('#labCost')).toHaveText('150 credits');
  });

  test('Generate Lab reference slots choose ordered Assets Manager images before applying', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    await mockGenerateLabMemberSession(page, {
      userId: 'generate-lab-picker-member',
      email: 'picker@bitbi.ai',
      credits: 1200,
    });
    await mockGenerateLabSavedImageAssets(page, [
      ...buildGenerateLabImageAssets(9),
      {
        id: 'asset-video-incompatible',
        asset_type: 'video',
        title: 'Incompatible Video Asset',
        mime_type: 'video/mp4',
        file_url: '/api/ai/text-assets/asset-video-incompatible/file',
        poster_url: '/api/ai/text-assets/asset-video-incompatible/poster',
        size_bytes: TEST_MP4_BYTES.length,
        created_at: '2026-06-05T08:30:00.000Z',
      },
    ]);

    await page.goto('/generate-lab/');
    await page.selectOption('#labImageModel', 'openai/gpt-image-2');
    await page.locator('#labImageRefPrimary .generate-lab-ref-images__slot-label').first().click();
    const sourceDialog = page.locator('#labReferenceSourceDialog');
    await expect(sourceDialog).toBeVisible();
    await expect(sourceDialog).toContainText('Choose reference source');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await sourceDialog.getByRole('button', { name: 'Upload from computer' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: 'local-reference.png', mimeType: 'image/png', buffer: TEST_PNG_BYTES });
    await expect(page.locator('#labImageReferenceCount')).toHaveText('1 / 16');

    await page.locator('#labImageRefPrimary .generate-lab-ref-images__slot-label').nth(1).click();
    await sourceDialog.getByRole('button', { name: 'Choose from Assets Manager' }).click();
    const overlay = page.locator('#labAssetsOverlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveClass(/generate-lab-assets-overlay--picker/);
    await expect(page.locator('#labAssetsPickerCount')).toHaveText('0 / 15 selected');
    await expect(page.locator('#labAssetsSelectBtn')).toBeDisabled();

    const firstAsset = page.locator('#labAssetsGrid [data-asset-id="asset-ref-1"]');
    const secondAsset = page.locator('#labAssetsGrid [data-asset-id="asset-ref-2"]');
    await expect(firstAsset).toBeVisible();
    await firstAsset.click();
    await secondAsset.click();
    await expect(firstAsset.locator('.studio__reference-order-badge')).toHaveText('1');
    await expect(secondAsset.locator('.studio__reference-order-badge')).toHaveText('2');
    await firstAsset.click();
    await expect(firstAsset.locator('.studio__reference-order-badge')).toHaveCount(0);
    await expect(secondAsset.locator('.studio__reference-order-badge')).toHaveText('1');

    await page.locator('#labAssetsPickerApply').click();
    await expect(overlay).toBeHidden();
    await expect(page.locator('#labImageReferenceCount')).toHaveText('2 / 16');
    await expect(page.locator('#labImageRefPrimary')).toContainText('Asset Reference 2');

    await page.selectOption('#labImageModel', 'black-forest-labs/flux-2-max');
    await page.locator('#labImageRefPrimary .generate-lab-ref-images__slot-label').first().click();
    await sourceDialog.getByRole('button', { name: 'Choose from Assets Manager' }).click();
    await expect(page.locator('#labAssetsPickerCount')).toHaveText('0 / 8 selected');
    for (let index = 1; index <= 8; index += 1) {
      await page.locator(`#labAssetsGrid [data-asset-id="asset-ref-${index}"]`).click();
    }
    await expect(page.locator('#labAssetsPickerCount')).toHaveText('8 / 8 selected');
    await page.locator('#labAssetsGrid [data-asset-id="asset-ref-9"]').click();
    await expect(page.locator('#labAssetsMsg')).toContainText('You can select up to 8 reference images.');
  });

  test('Generate Lab video image-input picker applies an image asset data URL payload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    const videoPayloads = [];
    await mockGenerateLabMemberSession(page, {
      userId: 'generate-lab-video-picker-member',
      email: 'video-picker@bitbi.ai',
      credits: 1200,
    });
    await mockGenerateLabSavedImageAssets(page, buildGenerateLabImageAssets(2));
    await page.route('**/api/ai/generate-video', async (route) => {
      videoPayloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            videoUrl: '/api/ai/text-assets/pixverse-picked/file',
            model: { id: 'pixverse/v6', label: 'PixVerse V6', vendor: 'PixVerse' },
            asset: { id: 'pixverse-picked', source_module: 'video', mime_type: 'video/mp4' },
          },
          billing: { balance_after: 1015 },
        }),
      });
    });

    await page.goto('/generate-lab/');
    await page.getByRole('tab', { name: 'Video' }).click();
    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'PixVerse V6' }).click();
    await expect(page.locator('#labVideoReferenceField')).toBeVisible();
    await page.locator('#labVideoReferenceTrigger').click();
    await expect(page.locator('#labReferenceSourceDialog')).toBeVisible();
    await page.locator('#labReferenceSourceDialog').getByRole('button', { name: 'Choose from Assets Manager' }).click();
    await expect(page.locator('#labAssetsPickerCount')).toHaveText('0 / 1 selected');
    await page.locator('#labAssetsGrid [data-asset-id="asset-ref-1"]').click();
    await page.locator('#labAssetsPickerApply').click();
    await expect(page.locator('#labAssetsOverlay')).toBeHidden();
    await expect(page.locator('#labVideoReferenceLabel')).toHaveText('Asset Reference 1');
    await expect(page.locator('#labVideoReferenceRemove')).toBeVisible();

    await page.locator('#labPrompt').fill('PixVerse image input from saved asset');
    await page.locator('#labGenerate').click();
    await expect.poll(() => videoPayloads.length).toBe(1);
    expect(videoPayloads[0].image_input).toMatch(/^data:image\/png;base64,/);
    expect(videoPayloads[0]).toMatchObject({
      model: 'pixverse/v6',
      prompt: 'PixVerse image input from saved asset',
    });
  });

  test('Generate Lab shows generation status, save retry guidance, and Assets Manager handoff', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    let saveAttempts = 0;
    let assetListRequests = 0;
    let releaseGenerateResponse;
    let markGenerateRequestStarted;
    const generateResponseGate = new Promise((resolve) => {
      releaseGenerateResponse = resolve;
    });
    const generateRequestStarted = new Promise((resolve) => {
      markGenerateRequestStarted = resolve;
    });

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-save-member', email: 'save@bitbi.ai', role: 'user' },
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
      assetListRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { assets: [], next_cursor: null, has_more: false, applied_limit: 6 } }),
      });
    });
    await page.route('**/api/ai/generate-image', async (route) => {
      markGenerateRequestStarted();
      await generateResponseGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=',
            mimeType: 'image/png',
            prompt: 'Neon library archive',
            model: '@cf/black-forest-labs/flux-1-schnell',
          },
          billing: { balance_after: 399 },
        }),
      });
    });
    await page.route('**/api/ai/images/save', async (route) => {
      saveAttempts += 1;
      if (saveAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary save failure.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: 'saved-image-one' } }),
      });
    });

    await page.goto('/generate-lab/');
    await expect(page.locator('#labWorkflowStatus')).toBeHidden();
    await expect(page.locator('#labCurrentResult')).toHaveCount(0);
    await expect(page.locator('#labResultStage')).toBeVisible();
    await page.locator('#labPrompt').fill('Neon library archive');

    await page.locator('#labGenerate').click();
    await generateRequestStarted;
    await expect(page.locator('#labWorkflowStatus')).toContainText('Generation in progress');
    await expect(page.locator('#labGenerate')).toBeDisabled();
    releaseGenerateResponse();

    await expect(page.locator('#labResultStage .generate-lab__image-output')).toBeVisible();
    await expect(page.locator('#labWorkflowStatus')).toContainText('Preview ready');
    await expect(page.locator('#labMessage')).toContainText('Image generated. Save it when you are ready.');
    await expect(page.locator('#labCostInsight')).toBeHidden();
    await expect(page.locator('#labBalance')).toContainText('399 credits');
    await expect(page.getByRole('button', { name: 'Save to Assets Manager' })).toBeVisible();

    await page.getByRole('button', { name: 'Save to Assets Manager' }).click();
    await expect(page.locator('#labWorkflowStatus')).toContainText('Needs attention');
    await expect(page.locator('#labMessage')).toContainText('preview is still available');
    await expect(page.getByRole('button', { name: 'Save to Assets Manager' })).toBeVisible();

    await page.getByRole('button', { name: 'Save to Assets Manager' }).click();
    await expect(page.locator('#labWorkflowStatus')).toContainText('Saved to Assets Manager');
    await expect(page.locator('#labMessage')).toContainText('Image saved');
    await expect(page.locator('#labJumpToPreview')).toHaveCount(0);
    await expect(page.locator('#labResultCreditsLink')).toHaveCount(0);
    const handoffLink = page.getByRole('link', { name: 'View in Assets Manager' });
    await expect(handoffLink).toBeVisible();
    await expect(handoffLink).toHaveAttribute('href', '/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    await expect(page.locator('#labResultStage')).toContainText('Next: open Assets Manager to confirm it loaded');
    const handoffHref = await handoffLink.getAttribute('href');
    expect(handoffHref).not.toContain('saved-image-one');
    const sessionSnapshot = await page.evaluate(() => Object.values(sessionStorage).join('\n'));
    expect(sessionSnapshot).not.toContain('saved-image-one');
    await expect.poll(() => assetListRequests).toBeGreaterThanOrEqual(2);
  });

  test('Generate Lab sends allowlisted FLUX.2 Max and Grok Imagine Video payloads', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    const imagePayloads = [];
    const videoPayloads = [];
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-payload-member', email: 'payload@bitbi.ai', role: 'user' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { creditBalance: 1000 } }),
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
    await page.route('**/api/ai/generate-image', async (route) => {
      imagePayloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=',
            mimeType: 'image/png',
            prompt: 'FLUX.2 Max payload check',
            model: 'black-forest-labs/flux-2-max',
            width: 1024,
            height: 1024,
            outputFormat: 'jpeg',
            safetyTolerance: 2,
            seed: 123,
          },
          billing: { balance_after: 954 },
        }),
      });
    });
    await page.route('**/api/ai/generate-video', async (route) => {
      videoPayloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            videoUrl: '/api/ai/text-assets/grok-video/file',
            model: { id: 'xai/grok-imagine-video', label: 'Grok Imagine Video', vendor: 'xAI' },
            duration: 5,
            aspect_ratio: '16:9',
            resolution: '720p',
            asset: { id: 'grok-video', source_module: 'video', mime_type: 'video/mp4' },
          },
          billing: { balance_after: 790 },
        }),
      });
    });

    await page.goto('/generate-lab/');
    await page.selectOption('#labImageModel', 'black-forest-labs/flux-2-max');
    await page.locator('#labImageSeed').fill('123');
    await page.locator('#labPrompt').fill('FLUX.2 Max payload check');
    await page.locator('#labGenerate').click();
    await expect.poll(() => imagePayloads.length).toBe(1);
    expect(imagePayloads[0]).toEqual({
      model: 'black-forest-labs/flux-2-max',
      prompt: 'FLUX.2 Max payload check',
      width: 1024,
      height: 1024,
      outputFormat: 'jpeg',
      safetyTolerance: 2,
      seed: 123,
    });
    expect(imagePayloads[0]).not.toHaveProperty('steps');
    expect(imagePayloads[0]).not.toHaveProperty('quality');
    expect(imagePayloads[0]).not.toHaveProperty('size');
    expect(imagePayloads[0]).not.toHaveProperty('background');
    expect(imagePayloads[0]).not.toHaveProperty('guidance');

    await page.getByRole('tab', { name: 'Video' }).click();
    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'Grok Imagine Video' }).click();
    await page.locator('#labPrompt').fill('Grok Imagine payload check');
    await page.locator('#labGenerate').click();
    await expect.poll(() => videoPayloads.length).toBe(1);
    expect(videoPayloads[0]).toEqual({
      model: 'xai/grok-imagine-video',
      prompt: 'Grok Imagine payload check',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
    });
    expect(videoPayloads[0]).not.toHaveProperty('quality');
    expect(videoPayloads[0]).not.toHaveProperty('seed');
    expect(videoPayloads[0]).not.toHaveProperty('negative_prompt');
    expect(videoPayloads[0]).not.toHaveProperty('image_input');
    expect(videoPayloads[0]).not.toHaveProperty('generate_audio');
    expect(videoPayloads[0]).not.toHaveProperty('watermark');
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

    await expect(page.locator('.generate-lab__session-panel')).toHaveCount(0);
    await expect(page.locator('#labAccountStatus')).toContainText('Angemeldet als labor@bitbi.ai');
    await expect(page.locator('#labCreditStatus')).toHaveText('900 Credits');
    await expect(page.locator('main')).not.toContainText('Status des angemeldeten Workspace');
    await expect(page.locator('#labWorkflowStatus')).toBeHidden();
    await expect(page.locator('#labCostInsight')).toBeHidden();
    await expect(page.locator('#labCreditsLink')).toHaveCount(0);
    await expect(page.locator('.generate-lab__composer-flow')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Bereit zum Konfigurieren');
    await expect(page.locator('main')).not.toContainText('Wählen Sie ein Modell, prüfen Sie die geschätzten Credits');
    await expect(page.locator('main')).not.toContainText('Alle gespeicherten anzeigen');

    await page.getByRole('tab', { name: 'Video' }).click();
    await expect(page.locator('#labModelList').getByText('Seedance 2.0 Fast')).toBeVisible();
    await expect(page.getByText('Seedance 2.0', { exact: true })).toHaveCount(0);
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

    await page.locator('#labModelList .generate-lab__model-card').filter({ hasText: 'Seedance 2.0 Fast' }).click();
    await expect(page.locator('#labCost')).toHaveText('252 Credits');
    await expect(page.locator('#labVideoNegativeField')).toBeHidden();
    await expect(page.locator('#labVideoReferenceField')).toBeHidden();
    await expect(page.locator('#labVideoAudioField')).toBeHidden();
    await expect(page.locator('#labVideoWatermarkField')).toBeHidden();
    await expect(page.locator('label:has(#labVideoSeed)')).toBeHidden();
    await expect(page.locator('#labVideoQualityLabel')).toHaveText('Auflösung');
    await expect(page.locator('#labVideoAspectLabel')).toHaveText('Format');
    await expect(page.locator('#labVideoDuration option').last()).toHaveAttribute('value', '12');
    await expect(page.locator('#labVideoDuration option[value="15"]')).toHaveCount(0);
    await expect(page.locator('#labVideoQuality option')).toHaveText(['480p', '720p']);
    await expect(page.locator('#labVideoQuality option[value="1080p"]')).toHaveCount(0);
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

  test('German Generate Lab Assets Manager shows storage usage directly left of Schließen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    const usedBytes = Math.round(14.5 * 1024 * 1024);
    const limitBytes = 50 * 1024 * 1024;
    let folderRequests = 0;
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-assets-de-member', email: 'assets-de@bitbi.ai', role: 'user' },
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
      folderRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            folders: [{ id: 'folder-one', name: 'Lab saves' }],
            counts: { 'folder-one': 1 },
            unfolderedCount: 0,
            storageUsage: {
              usedBytes,
              limitBytes,
              remainingBytes: limitBytes - usedBytes,
              isUnlimited: false,
            },
          },
        }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            assets: [],
            next_cursor: null,
            has_more: false,
            applied_limit: 6,
            storageUsage: {
              usedBytes,
              limitBytes,
              remainingBytes: limitBytes - usedBytes,
              isUnlimited: false,
            },
          },
        }),
      });
    });

    await page.goto('/de/generate-lab/');
    await page.locator('#labAssetsOpen').click();

    const overlay = page.getByRole('dialog', { name: 'Assets Manager' });
    const usage = overlay.locator('#labAssetsStorageUsage');
    const close = overlay.locator('#labAssetsOverlayClose');
    await expect(overlay).toBeVisible();
    await expect(usage).toHaveText('14,5 MB / 50 MB');
    await expect(usage).toHaveAttribute('aria-label', /Verwendeter Speicher im Assets Manager: 14,5 MB \/ 50 MB/);
    await expect(close).toHaveText('Schließen');
    await expect.poll(() => folderRequests).toBeGreaterThan(0);

    const usageBox = await usage.boundingBox();
    const closeBox = await close.boundingBox();
    expect(usageBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(usageBox.x + usageBox.width).toBeLessThanOrEqual(closeBox.x);
    expectWithinPx(
      usageBox.y + usageBox.height / 2,
      closeBox.y + closeBox.height / 2,
      'Generate Lab storage usage vertical alignment',
      3,
    );

    await close.click();
    await expect(overlay).toBeHidden();
  });

  test('Generate Lab Assets Manager shows unlimited storage usage for admins', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 });
    const usedBytes = Math.round(124.8 * 1024 * 1024);
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: { id: 'generate-lab-admin-assets-member', email: 'admin-assets@bitbi.ai', role: 'admin' },
        }),
      });
    });
    await page.route('**/api/ai/quota', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { isAdmin: true } }),
      });
    });
    await page.route('**/api/ai/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            folders: [],
            counts: {},
            unfolderedCount: 0,
            storageUsage: {
              usedBytes,
              limitBytes: null,
              remainingBytes: null,
              isUnlimited: true,
            },
          },
        }),
      });
    });
    await page.route('**/api/ai/assets?limit=6', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            assets: [],
            next_cursor: null,
            has_more: false,
            applied_limit: 6,
            storageUsage: {
              usedBytes,
              limitBytes: null,
              remainingBytes: null,
              isUnlimited: true,
            },
          },
        }),
      });
    });

    await page.goto('/generate-lab/');
    await page.locator('#labAssetsOpen').click();

    const overlay = page.getByRole('dialog', { name: 'Assets Manager' });
    const usage = overlay.locator('#labAssetsStorageUsage');
    const close = overlay.locator('#labAssetsOverlayClose');
    await expect(overlay).toBeVisible();
    await expect(usage).toHaveText('124,8 MB / ∞');
    await expect(usage).toHaveAttribute('aria-label', /Used storage in Assets Manager: 124,8 MB \/ ∞/);
    await expect(close).toHaveText('Close');

    const usageBox = await usage.boundingBox();
    const closeBox = await close.boundingBox();
    expect(usageBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(usageBox.x + usageBox.width).toBeLessThanOrEqual(closeBox.x);
    expectWithinPx(
      usageBox.y + usageBox.height / 2,
      closeBox.y + closeBox.height / 2,
      'Generate Lab admin storage usage vertical alignment',
      3,
    );

    await close.click();
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
    await expect(page.locator('.generate-lab__recent-copy')).toContainText('Backend-loaded saved assets');
    await expect(page.getByRole('link', { name: 'Show all saved' })).toHaveCount(0);
    await expect(page.locator('#labRecentAssetsOpen')).toBeVisible();

    await page.getByRole('button', { name: 'Open Neon image in Generate Lab preview' }).click();
    await expect(page.locator('#labResultStage .generate-lab__image-output')).toBeVisible();
    await expect(page.locator('#labResultStage .generate-lab__image-output')).toHaveAttribute('src', /recent-img\/medium/);
    await expect(page.locator('#labCurrentResult')).toHaveCount(0);
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
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Creation Workspace');
    await page.goto('/legal/imprint.html');

    await expect(page.locator('header .site-nav__context-label')).toHaveText('Creation Workspace');
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
    await expect(page.locator('header .site-nav__context-label')).toHaveText('Creation Workspace');
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#deniedState .profile__link')).toHaveAttribute('href', '/generate-lab/');

    await page.goto('/');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('bitbi:return-context'))).toBeNull();
    await page.goto('/legal/imprint.html');
    await expect(page.locator('header .site-nav__context-label:visible')).toHaveCount(0);
    await expect(page.locator('header .site-nav__logo')).toHaveAttribute('href', '/');
  });

  test('Generate Lab shows a desktop-optimized notice on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/generate-lab/');

    await expect(page.locator('.generate-lab__mobile-fallback')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Optimized for desktop' })).toBeVisible();
    await expect(page.getByText('This creation workspace is built for desktop.')).toBeVisible();
    await expect(page.locator('.generate-lab__mobile-actions').getByRole('link', { name: 'Open BITBI homepage' })).toHaveAttribute('href', '/');
    await expect(page.locator('.generate-lab__desktop')).toBeHidden();
    await expect(page.locator('#labPrompt')).toBeHidden();
    await expect(page.locator('#labGenerate')).toBeHidden();
    await expect(page.locator('#labCreditRecovery')).toHaveCount(0);
    await expect(page.locator('#labCurrentResult')).toHaveCount(0);
    const hasDocumentOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasDocumentOverflow).toBe(false);
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

      if (pathname === '/') {
        await expect(page.locator('body')).toHaveClass(/home-categories-desktop-stage/);
        const desktopFooterSpacing = await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          const footer = document.querySelector('.site-footer');
          const copy = document.querySelector('.site-footer__copy');
          const help = document.querySelector('.help-menu__trigger');
          const footerRect = footer?.getBoundingClientRect();
          const copyRect = copy?.getBoundingClientRect();
          const helpRect = help?.getBoundingClientRect();
          return {
            bottomGap: footerRect && copyRect ? Math.round((footerRect.bottom - copyRect.bottom) * 100) / 100 : 0,
            helpVisible: Boolean(helpRect && helpRect.width >= 44 && helpRect.height >= 44),
            helpBottomGap: helpRect ? Math.round((window.innerHeight - helpRect.bottom) * 100) / 100 : 0,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          };
        });
        expect(desktopFooterSpacing.bottomGap).toBeGreaterThanOrEqual(48);
        expect(desktopFooterSpacing.bottomGap).toBeLessThanOrEqual(100);
        expect(desktopFooterSpacing.helpVisible).toBe(true);
        expect(desktopFooterSpacing.helpBottomGap).toBeGreaterThanOrEqual(8);
        expect(desktopFooterSpacing.scrollWidth).toBeLessThanOrEqual(desktopFooterSpacing.clientWidth + 1);
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const mobileFooterSpacing = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const footer = document.querySelector('.site-footer');
      const copy = document.querySelector('.site-footer__copy');
      const help = document.querySelector('.help-menu__trigger');
      const footerRect = footer?.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      const helpRect = help?.getBoundingClientRect();
      return {
        bottomGap: footerRect && copyRect ? Math.round((footerRect.bottom - copyRect.bottom) * 100) / 100 : 0,
        helpVisible: Boolean(helpRect && helpRect.width >= 44 && helpRect.height >= 44),
        helpRightGap: helpRect ? Math.round((window.innerWidth - helpRect.right) * 100) / 100 : 0,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(mobileFooterSpacing.bottomGap).toBeLessThanOrEqual(40);
    expect(mobileFooterSpacing.helpVisible).toBe(true);
    expect(mobileFooterSpacing.helpRightGap).toBeGreaterThanOrEqual(8);
    expect(mobileFooterSpacing.scrollWidth).toBeLessThanOrEqual(mobileFooterSpacing.clientWidth + 1);
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
        const modeButtons = Array.from(section?.querySelectorAll('.video-mode__btn') || []);
        const [firstModeButton, secondModeButton] = modeButtons.map((button) => button.getBoundingClientRect());
        const contentRect = section?.querySelector('#videoExplore')?.getBoundingClientRect();
        const title = section?.querySelector('.section__title');
        const titleRect = title?.getBoundingClientRect();
        const titleStyle = title ? window.getComputedStyle(title) : null;
        const modeStyle = section?.querySelector('.video-mode')
          ? window.getComputedStyle(section.querySelector('.video-mode'))
          : null;
        return {
          descriptionsPresent: document.querySelectorAll('#gallery .section__desc, #video-creations .section__desc, #soundlab .section__desc').length,
          modeHintsPresent: document.querySelectorAll('#gallery .gallery-mode__hint, #video-creations .video-mode__hint, #soundlab .video-mode__hint').length,
          headingActionGap: titleRect && firstModeButton ? firstModeButton.top - titleRect.bottom : 0,
          modeContentGap: modeRect && contentRect ? contentRect.top - modeRect.bottom : 0,
          modeButtonGap: firstModeButton && secondModeButton ? secondModeButton.left - firstModeButton.right : 0,
          modePaddingTop: modeStyle ? parseFloat(modeStyle.paddingTop) : 0,
          modePaddingBottom: modeStyle ? parseFloat(modeStyle.paddingBottom) : 0,
          sectionPaddingTop: sectionStyle ? parseFloat(sectionStyle.paddingTop) : 0,
          sectionTopToHeading: sectionStyle && headerStyle
            ? parseFloat(sectionStyle.paddingTop) + parseFloat(headerStyle.paddingTop)
            : sectionRect && titleRect ? titleRect.top - sectionRect.top : 0,
          headerMarginBottom: headerStyle ? parseFloat(headerStyle.marginBottom) : 0,
          titleFontSize: titleStyle ? parseFloat(titleStyle.fontSize) : 0,
          dividerVisible: Boolean(before && before.content !== 'none' && parseFloat(before.width) > 0.5),
          dividerWidth: before ? parseFloat(before.width) : 0,
          sectionWidth: sectionRect?.width || 0,
        };
      });

      expect(desktopMetrics.descriptionsPresent).toBe(0);
      expect(desktopMetrics.modeHintsPresent).toBe(0);
      expect(desktopMetrics.titleFontSize).toBeGreaterThan(53);
      expect(desktopMetrics.titleFontSize).toBeLessThan(55);
      expect(desktopMetrics.headingActionGap).toBeGreaterThan(24);
      expect(desktopMetrics.headingActionGap).toBeLessThan(29);
      expect(desktopMetrics.modeContentGap).toBeGreaterThan(8);
      expect(desktopMetrics.modeContentGap).toBeLessThan(12);
      expect(desktopMetrics.modeButtonGap).toBeGreaterThan(45);
      expect(desktopMetrics.modeButtonGap).toBeLessThan(48);
      expect(desktopMetrics.modePaddingTop).toBeGreaterThan(7);
      expect(desktopMetrics.modePaddingTop).toBeLessThan(9);
      expect(desktopMetrics.modePaddingBottom).toBeGreaterThan(7);
      expect(desktopMetrics.modePaddingBottom).toBeLessThan(9);
      expect(desktopMetrics.sectionTopToHeading).toBeGreaterThan(20);
      expect(desktopMetrics.sectionTopToHeading).toBeLessThan(22);
      expect(desktopMetrics.headerMarginBottom).toBeGreaterThan(17);
      expect(desktopMetrics.headerMarginBottom).toBeLessThan(20);
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

    await routeDefaultMemtracks(page, { modelLabel: '' });

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
    const injectCategoryMeasurementStyles = async () => {
      await page.addStyleTag({
        content: `
        html,
        body {
          scroll-behavior: auto !important;
        }

        #homeCategories .reveal,
        #homeCategories .reveal.visible {
          opacity: 1 !important;
          transform: none !important;
          transition: none !important;
          animation: none !important;
        }

        #homeCategories .home-categories__viewport,
        #homeCategories .home-categories__panel,
        #homeCategories .section__header--sm,
        #homeCategories .gallery-mode,
        #homeCategories .video-mode {
          transition: none !important;
          animation: none !important;
        }
      `,
      });
    };

    const stabilizeCategoryLayout = async (category) => {
      // Keep visual-only category animations from affecting bounding-rect reads in CI.
      await page.evaluate(async () => {
        try {
          await document.fonts?.ready;
        } catch {
          // Font readiness is best-effort in tests.
        }
      });
      await page.waitForFunction((targetCategory) => {
        const stage = document.getElementById('homeCategories');
        const panel = document.querySelector(`[data-category-panel="${targetCategory}"]`);
        const nav = document.querySelector('#navbar .site-nav__links');
        const navStyle = nav ? window.getComputedStyle(nav) : null;
        const desktopCategoryMode = Boolean(
          nav
          && navStyle
          && navStyle.display !== 'none'
          && navStyle.visibility !== 'hidden'
          && nav.getBoundingClientRect().width > 0
        );
        const panelRect = panel?.getBoundingClientRect();
        const panelReady = Boolean(
          stage
          && panel
          && panelRect
          && panelRect.width > 0
          && panelRect.height > 0
          && !stage.classList.contains('is-transitioning')
        );
        if (!desktopCategoryMode) return panelReady;
        return Boolean(
          panelReady
          && stage.dataset.activeCategory === targetCategory
          && !stage.classList.contains('is-transitioning')
          && panel.classList.contains('is-active')
          && panel.getAttribute('aria-hidden') === 'false'
        );
      }, category, { timeout: 10_000 });
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    };

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await injectCategoryMeasurementStyles();
    await stabilizeCategoryLayout('video');

    await expect(page.locator('#gallery .section__label')).toHaveCount(0);
    await expect(page.locator('#video-creations .section__label')).toHaveCount(0);
    await expect(page.locator('#soundlab .section__label')).toHaveCount(0);

    await expectActiveHomepageCategory(page, 'video');
    await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();
    await switchHomepageCategory(page, 'gallery');
    await stabilizeCategoryLayout('gallery');
    await expect(page.locator('#galleryGrid .gallery-item:not(.locked-area)').first()).toBeVisible();
    await switchHomepageCategory(page, 'sound');
    await stabilizeCategoryLayout('sound');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();

    const readActiveCategoryMetrics = async (selector, modeSelector, contentSelector) => page.evaluate((args) => {
      const section = document.querySelector(args.selector);
      const header = section?.querySelector('.section__header--sm');
      const title = section?.querySelector('.section__title');
      const mode = section?.querySelector(args.modeSelector);
      const content = section?.querySelector(args.contentSelector);
      const buttons = Array.from(mode?.querySelectorAll('[role="tab"]') || []);
      const first = buttons[0]?.getBoundingClientRect();
      const second = buttons[1]?.getBoundingClientRect();
      const modeRect = mode?.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const sectionStyle = window.getComputedStyle(section);
      const headerStyle = window.getComputedStyle(header);
      const modeStyle = mode ? window.getComputedStyle(mode) : null;
      const titleRect = title?.getBoundingClientRect();
      return {
        titleFontSize: parseFloat(window.getComputedStyle(title).fontSize),
        sectionTopToHeading: parseFloat(sectionStyle.paddingTop) + parseFloat(headerStyle.paddingTop),
        headerMarginBottom: parseFloat(headerStyle.marginBottom),
        headingActionGap: titleRect && first ? first.top - titleRect.bottom : 0,
        actionContentGap: modeRect && contentRect ? contentRect.top - modeRect.bottom : 0,
        actionGap: first && second ? second.left - first.right : 0,
        modePaddingTop: modeStyle ? parseFloat(modeStyle.paddingTop) : 0,
        modePaddingBottom: modeStyle ? parseFloat(modeStyle.paddingBottom) : 0,
      };
    }, { selector, modeSelector, contentSelector });

    const desktopCategoryMetrics = {};
    await switchHomepageCategory(page, 'video');
    await stabilizeCategoryLayout('video');
    desktopCategoryMetrics.video = await readActiveCategoryMetrics('#video-creations', '.video-mode', '#videoExplore');
    await switchHomepageCategory(page, 'gallery');
    await stabilizeCategoryLayout('gallery');
    desktopCategoryMetrics.gallery = await readActiveCategoryMetrics('#gallery', '.gallery-mode', '#galleryExplore');
    await switchHomepageCategory(page, 'sound');
    await stabilizeCategoryLayout('sound');
    desktopCategoryMetrics.sound = await readActiveCategoryMetrics('#soundlab', '.video-mode', '#soundLabExplore');

    Object.entries(desktopCategoryMetrics).forEach(([category, metrics]) => {
      expect(metrics.titleFontSize, `${category} heading`).toBeGreaterThan(53);
      expect(metrics.titleFontSize, `${category} heading`).toBeLessThan(55);
      expect(metrics.sectionTopToHeading, `${category} top-to-heading gap corrected`).toBeGreaterThan(20);
      expect(metrics.sectionTopToHeading, `${category} top-to-heading gap corrected`).toBeLessThan(22);
      expect(metrics.headerMarginBottom, `${category} header gap`).toBeGreaterThan(17);
      expect(metrics.headerMarginBottom, `${category} header gap`).toBeLessThan(20);
      expect(metrics.headingActionGap, `${category} heading-to-action gap`).toBeGreaterThan(24);
      expect(metrics.headingActionGap, `${category} heading-to-action gap`).toBeLessThan(29);
      expect(metrics.actionContentGap, `${category} action-to-content gap corrected`).toBeGreaterThan(8);
      expect(metrics.actionContentGap, `${category} action-to-content gap corrected`).toBeLessThan(12);
      expect(metrics.actionGap, `${category} action horizontal gap`).toBeGreaterThan(45);
      expect(metrics.actionGap, `${category} action horizontal gap`).toBeLessThan(48);
      expect(metrics.modePaddingTop, `${category} action padding top`).toBeGreaterThan(7);
      expect(metrics.modePaddingTop, `${category} action padding top`).toBeLessThan(9);
      expect(metrics.modePaddingBottom, `${category} action padding bottom`).toBeGreaterThan(7);
      expect(metrics.modePaddingBottom, `${category} action padding bottom`).toBeLessThan(9);
    });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await injectCategoryMeasurementStyles();
    await stabilizeCategoryLayout('video');

    const readActiveGhostState = async (selector) => page.evaluate((activeSelector) => {
      const section = document.querySelector(activeSelector);
      const root = section?.querySelector('.category-ghost-models');
      const sectionRect = section?.getBoundingClientRect();
      const contentRect = section?.querySelector('#galleryExplore, #videoExplore, #soundLabExplore')?.getBoundingClientRect();
      const actionRects = Array.from(section?.querySelectorAll('.gallery-mode [role="tab"], .video-mode [role="tab"]') || [])
        .map((node) => node.getBoundingClientRect());
      const centerX = sectionRect ? sectionRect.left + (sectionRect.width / 2) : 0;
      const titleVisualRect = { left: centerX - 340, right: centerX + 340 };
      const centralRects = [titleVisualRect, ...actionRects].filter(Boolean);
      const centralLeft = Math.min(...centralRects.map((rect) => rect.left));
      const centralRight = Math.max(...centralRects.map((rect) => rect.right));
      const nodes = Array.from(root?.querySelectorAll('.category-ghost-models__name') || []);
      const overlaps = (rect, target) => Boolean(
        rect && target
        && rect.left < target.right
        && rect.right > target.left
        && rect.top < target.bottom
        && rect.bottom > target.top
      );
      const names = nodes
        .map((node) => node.textContent.trim())
        .filter(Boolean);
      const details = nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const side = node.dataset.ghostSide || '';
        const peakOpacity = Number.parseFloat(style.getPropertyValue('--ghost-peak-opacity')) || 0;
        return {
          name: node.textContent.trim(),
          side,
          slot: node.dataset.ghostSlot || '',
          cycle: node.dataset.ghostCycle || '',
          opacity: Number(style.opacity || 0),
          peakOpacity,
          pointerEvents: style.pointerEvents,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          outsideCentralCluster: rect.right < centralLeft || rect.left > centralRight,
          withinSafeZone: side === 'right'
            ? rect.left > centralRight && rect.right <= (sectionRect?.right || rect.right) + 1
            : rect.right < centralLeft && rect.left >= (sectionRect?.left || rect.left) - 1,
          avoidsActions: actionRects.every((actionRect) => !overlaps(rect, actionRect)),
          avoidsGrid: !contentRect || !overlaps(rect, contentRect),
        };
      });
      const rootStyle = root ? window.getComputedStyle(root) : null;
      return {
        names,
        details,
        hidden: root?.hidden ?? true,
        source: root?.dataset.ghostSource || '',
        rotation: root?.dataset.ghostRotation || '',
        rootCycle: root?.dataset.ghostCycle || '',
        ariaHidden: root?.getAttribute('aria-hidden') || '',
        rootDisplay: rootStyle?.display || '',
        rootPointerEvents: rootStyle?.pointerEvents || '',
        rootZIndex: rootStyle ? Number(rootStyle.zIndex || 0) : 0,
        namePointerEvents: root?.firstElementChild ? window.getComputedStyle(root.firstElementChild).pointerEvents : '',
        maxOpacity: Math.max(0, ...details.map((detail) => detail.opacity)),
        maxPeakOpacity: Math.max(0, ...details.map((detail) => detail.peakOpacity)),
        outsideCentralCluster: details.length > 0 && details.every((detail) => detail.outsideCentralCluster),
        withinSafeZones: details.length > 0 && details.every((detail) => detail.withinSafeZone),
        avoidsActions: details.length > 0 && details.every((detail) => detail.avoidsActions),
        avoidsGrid: details.length > 0 && details.every((detail) => detail.avoidsGrid),
        slotSignature: details.map((detail) => `${detail.name}:${detail.side}:${detail.slot}`).join('|'),
        leftCount: details.filter((detail) => detail.side === 'left').length,
        rightCount: details.filter((detail) => detail.side === 'right').length,
      };
    }, selector);

    const ghostState = {};
    await switchHomepageCategory(page, 'gallery');
    await stabilizeCategoryLayout('gallery');
    ghostState.gallery = await readActiveGhostState('#gallery');
    await switchHomepageCategory(page, 'video');
    await stabilizeCategoryLayout('video');
    ghostState.video = await readActiveGhostState('#video-creations');
    await switchHomepageCategory(page, 'sound');
    await stabilizeCategoryLayout('sound');
    ghostState.sound = await readActiveGhostState('#soundlab');

    expect(ghostState.gallery.hidden).toBe(false);
    expect(ghostState.gallery.source).toBe('category-config');
    expect(ghostState.gallery.names).toEqual(['FLUX.1 Schnell', 'FLUX.2 Klein 9B', 'FLUX.2 Max', 'GPT Image 2']);
    expect(ghostState.gallery.names).not.toContain('Seedance 2.0 Fast');
    expect(ghostState.gallery.names).not.toContain('HappyHorse 1.0 T2V');
    expect(ghostState.gallery.names).not.toContain('Music 2.6');
    expect(ghostState.video.hidden).toBe(false);
    expect(ghostState.video.source).toBe('category-config');
    expect(ghostState.video.names).toEqual(['PixVerse V6', 'HappyHorse 1.0 T2V', 'Seedance 2.0 Fast', 'Grok Imagine Video']);
    expect(ghostState.video.names).not.toContain('FLUX.1 Schnell');
    expect(ghostState.video.names).not.toContain('GPT Image 2');
    expect(ghostState.video.names).not.toContain('Music 2.6');
    expect(ghostState.video.names).not.toContain('Seedance 2.0');
    expect(ghostState.video.names).not.toContain('Vidu Q3 Pro');
    expect(ghostState.sound.hidden).toBe(false);
    expect(ghostState.sound.source).toBe('category-config');
    expect(ghostState.sound.names).toEqual(['Music 2.6']);
    expect(ghostState.sound.names).not.toContain('FLUX.1 Schnell');
    expect(ghostState.sound.names).not.toContain('Seedance 2.0 Fast');
    for (const state of Object.values(ghostState)) {
      expect(new Set(state.names).size).toBe(state.names.length);
      expect(state.ariaHidden).toBe('true');
      expect(state.rootDisplay).toBe('block');
      expect(state.rootPointerEvents).toBe('none');
      expect(state.rootZIndex).toBeGreaterThanOrEqual(2);
      expect(state.rotation).toBe('seeded-safe-slots');
      expect(state.rootCycle).toMatch(/^\d+$/);
      expect(state.namePointerEvents).toBe('none');
      expect(state.maxOpacity).toBeGreaterThan(0.18);
      expect(state.maxPeakOpacity).toBeGreaterThanOrEqual(0.46);
      expect(state.outsideCentralCluster, JSON.stringify(state.details)).toBe(true);
      expect(state.withinSafeZones, JSON.stringify(state.details)).toBe(true);
      expect(state.avoidsActions, JSON.stringify(state.details)).toBe(true);
      expect(state.avoidsGrid, JSON.stringify(state.details)).toBe(true);
      expect(state.leftCount).toBeGreaterThanOrEqual(1);
    }
    expect(ghostState.gallery.rightCount).toBeGreaterThanOrEqual(1);
    expect(ghostState.video.rightCount).toBeGreaterThanOrEqual(1);

    await switchHomepageCategory(page, 'video');
    await stabilizeCategoryLayout('video');
    const initialVideoGhostSignature = ghostState.video.slotSignature;
    await expect.poll(async () => {
      const state = await readActiveGhostState('#video-creations');
      return state.rootCycle !== ghostState.video.rootCycle && state.slotSignature !== initialVideoGhostSignature;
    }, { timeout: 6000, intervals: [500] }).toBe(true);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedGhostMotion = await page.locator('#soundlab .category-ghost-models__name').first().evaluate((node) => {
      const style = window.getComputedStyle(node);
      return { animationName: style.animationName, opacity: style.opacity };
    });
    expect(reducedGhostMotion.animationName).toBe('none');
    expect(Number(reducedGhostMotion.opacity)).toBeGreaterThanOrEqual(0.2);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

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

    await switchHomepageCategory(page, 'sound');
    await stabilizeCategoryLayout('sound');
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator('#gallery .section__label')).toHaveCount(0);
    await expect(page.locator('#video-creations .section__label')).toHaveCount(0);
    await expect(page.locator('#soundlab .section__label')).toHaveCount(0);
    await expectActiveHomepageCategory(page, 'sound');
    await switchHomepageCategory(page, 'gallery');
    await stabilizeCategoryLayout('gallery');
    await expect(page.locator('#galleryGrid .gallery-item:not(.locked-area)').first()).toBeVisible();
    await switchHomepageCategory(page, 'video');
    await stabilizeCategoryLayout('video');
    await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();
    await switchHomepageCategory(page, 'sound');
    await stabilizeCategoryLayout('sound');
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
    const galleryAvatarBox = await mempicsCard.locator('.public-media-meta__avatar').boundingBox();
    expect(galleryAvatarBox).toBeTruthy();
    expect(galleryAvatarBox.width).toBeLessThanOrEqual(34);
    expect(galleryAvatarBox.height).toBeLessThanOrEqual(34);
    expect(Math.abs(galleryAvatarBox.width - galleryAvatarBox.height)).toBeLessThanOrEqual(1);
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

    // Gallery intentionally suppresses the first card click for 400 ms after
    // modal close so a stale click cannot immediately reopen the same image.
    await page.waitForTimeout(450);
    const secondMempicCard = page.locator('#galleryGrid .gallery-item:not(.locked-area):visible').nth(1);
    await secondMempicCard.click();
    await expect(page.locator('#modalTitle')).toHaveText('Second Mempic');
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', `/api/gallery/mempics/d4c3b2a1/${mempicVersion}/file`);
  });

  test('public media details overlays fit the viewport and keep comments in the Comments tab', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    const commentsRequests = [];
    const longTitle = 'Long public media title with emoji 🚀 detail';

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });

    await page.route(/\/api\/gallery\/(mempics|memvids|memtracks)\/[^/]+\/comments(?:\?.*)?$/, async (route) => {
      commentsRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { count: 0, comments: [] } }),
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
                id: 'detail-mempic',
                slug: 'detail-mempic',
                title: longTitle,
                caption: 'A long-caption public Mempic.',
                category: 'mempics',
                published_at: '2026-04-12T10:00:00.000Z',
                comment_count: 0,
                publisher: {
                  display_name: 'Ada Member',
                  stats: { public_media_count: 3 },
                },
                thumb: { url: '/api/gallery/mempics/detail-mempic/thumb', w: 360, h: 360 },
                preview: { url: '/api/gallery/mempics/detail-mempic/medium', w: 1600, h: 1200 },
                full: { url: '/api/gallery/mempics/detail-mempic/file' },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG_BYTES });
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
                id: 'detail-memvid',
                slug: 'detail-memvid',
                title: 'Detail Memvid',
                caption: 'A public Memvid.',
                category: 'memvids',
                published_at: '2026-04-13T10:00:00.000Z',
                comment_count: 0,
                publisher: {
                  display_name: 'Ada Member',
                  stats: { public_media_count: 3 },
                },
                file: { url: '/api/gallery/memvids/detail-memvid/file' },
                poster: { url: '/api/gallery/memvids/detail-memvid/poster', w: 1280, h: 720 },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/memvids\/[^/]+\/(file|poster)$/, async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG_BYTES });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: TEST_MP4_BYTES });
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
                id: 'detail-memtrack',
                slug: 'detail-memtrack',
                title: 'Detail Memtrack',
                caption: 'A public Memtrack.',
                category: 'memtracks',
                published_at: '2026-04-14T10:00:00.000Z',
                comment_count: 0,
                publisher: {
                  display_name: 'Ada Member',
                  stats: { public_media_count: 3 },
                },
                file: { url: '/api/gallery/memtracks/detail-memtrack/file' },
                poster: { url: '/api/gallery/memtracks/detail-memtrack/poster', w: 640, h: 640 },
              },
            ],
            has_more: false,
            next_cursor: null,
            applied_limit: 60,
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/memtracks\/[^/]+\/(file|poster)$/, async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG_BYTES });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('mock-audio') });
    });

    const expectPublicDetailFits = async (modalSelector) => {
      const metrics = await page.locator(`${modalSelector} .modal-content--public-detail`).evaluate((content) => {
        const card = content.querySelector('.modal-card--public-detail');
        const doc = document.documentElement;
        return {
          viewport: window.innerWidth,
          documentOverflow: doc.scrollWidth - doc.clientWidth,
          contentWidth: content.getBoundingClientRect().width,
          contentOverflow: content.scrollWidth - content.clientWidth,
          cardOverflow: (card?.scrollWidth || 0) - (card?.clientWidth || 0),
        };
      });
      expect(metrics.documentOverflow).toBeLessThanOrEqual(1);
      expect(metrics.contentOverflow).toBeLessThanOrEqual(1);
      expect(metrics.cardOverflow).toBeLessThanOrEqual(1);
      expect(metrics.contentWidth).toBeLessThanOrEqual(metrics.viewport * 0.8 + 1);
      expect(metrics.contentWidth).toBeGreaterThanOrEqual(metrics.viewport * 0.8 - 2);
    };

    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');

    await page.locator('#galleryGrid .gallery-item:not(.locked-area):visible').first().click();
    await expect(page.locator('#galleryModal')).toHaveClass(/active/);
    await expectPublicDetailFits('#galleryModal');

    const galleryDetail = page.locator('#galleryModal .public-media-detail-panel');
    const visibleTitle = await galleryDetail.locator('.public-media-detail__title').textContent();
    expect(Array.from(visibleTitle || '').length).toBeLessThanOrEqual(21);
    expect(visibleTitle).toMatch(/…$/);
    await expect(galleryDetail.locator('.public-media-detail__facts')).not.toContainText('Comment count');
    await expect(galleryDetail.locator('.public-media-detail__tab-panel--comments')).toBeHidden();
    await expect(galleryDetail.locator('.public-media-comments__input')).toBeHidden();
    await expect(galleryDetail).not.toContainText('No comments yet');
    expect(commentsRequests).toHaveLength(0);

    await galleryDetail.getByRole('tab', { name: 'Comments (0)' }).click();
    await expect.poll(() => commentsRequests.length).toBe(1);
    await expect(galleryDetail.locator('.public-media-comments__status')).toHaveText('No comments yet');
    await expect(galleryDetail.locator('.public-media-comments__auth-hint')).toHaveText('Sign in to write a comment.');
    await expect(galleryDetail.locator('.public-media-comments__input')).toBeHidden();
    await expect(galleryDetail.locator('.public-media-comments__submit')).toBeHidden();
    await expect(page.locator('.auth-modal__overlay.active')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await page.locator('#galleryModal .modal-close').click();

    await switchHomepageCategory(page, 'video');
    await page.locator('#videoGrid .video-card:visible').first().click();
    await expect(page.locator('#videoModal')).toHaveClass(/active/);
    await expectPublicDetailFits('#videoModal');
    await page.locator('#videoModal .video-modal-close').click();

    await switchHomepageCategory(page, 'sound');
    await waitForSoundWidthReady(page, 1);
    await page.locator('#soundLabTracks .snd-card--memtrack:visible .snd-hero').first().click();
    await expect(page.locator('#memtrackModal')).toHaveClass(/active/);
    await expectPublicDetailFits('#memtrackModal');
    await page.locator('#memtrackModal .memtrack-modal-close').click();
  });

  test('public media comments submit from the form and render newest first below the input', async ({ page }) => {
    const comments = Array.from({ length: 18 }, (_, index) => ({
      id: `comment-existing-${index + 1}`,
      body: index === 0 ? 'Newest existing comment' : `Older existing comment ${index}`,
      created_at: `2026-04-${String(16 - Math.min(index, 15)).padStart(2, '0')}T12:00:00.000Z`,
      author: { display_name: index === 0 ? 'Newest Member' : `Older Member ${index}` },
    }));
    const postedBodies = [];

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'comment-ui-user',
            email: 'comment-ui@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/comment-mempic\/interactions$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
            data: {
            like_count: 0,
            liked_by_viewer: false,
            comment_count: comments.length,
            can_follow: false,
            followed_by_viewer: false,
            follower_count: 0,
            is_own_media: false,
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/comment-mempic\/comments(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        postedBodies.push(body.body);
        const comment = {
          id: 'comment-posted-now',
          body: String(body.body || ''),
          created_at: '2026-04-17T12:00:00.000Z',
          author: { display_name: 'Posting Member' },
        };
        comments.unshift(comment);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: {
              comment,
              count: comments.length,
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            count: comments.length,
            comments,
          },
        }),
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
                id: 'comment-mempic',
                slug: 'comment-mempic',
                title: 'Comment Mempic',
                caption: 'A public Mempic with comments.',
                category: 'mempics',
                published_at: '2026-04-14T10:00:00.000Z',
                comment_count: comments.length,
                publisher: {
                  display_name: 'Ada Member',
                  stats: { public_media_count: 1 },
                },
                thumb: { url: '/api/gallery/mempics/comment-mempic/thumb', w: 360, h: 360 },
                preview: { url: '/api/gallery/mempics/comment-mempic/medium', w: 1200, h: 1200 },
                full: { url: '/api/gallery/mempics/comment-mempic/file' },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/comment-mempic\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG_BYTES });
    });

    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');
    await page.locator('#galleryGrid .gallery-item:not(.locked-area):visible').first().click();
    const detail = page.locator('#galleryModal .public-media-detail-panel');
    await detail.getByRole('tab', { name: 'Comments (18)' }).click();

    const form = detail.locator('.public-media-comments__form');
    const input = form.locator('.public-media-comments__input');
    const submit = form.locator('.public-media-comments__submit');
    await expect(submit).toHaveAttribute('type', 'submit');
    await expect(form).toBeVisible();
    await expect(input).toBeVisible();
    await expect(submit).toBeVisible();

    await input.focus();
    const focusStyle = await input.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        outline: style.outlineStyle,
        shadow: style.boxShadow,
        borderColor: style.borderColor,
      };
    });
    expect(focusStyle.outline).toBe('none');
    expect(focusStyle.shadow).not.toContain('0, 245, 212');
    expect(focusStyle.shadow).not.toContain('0, 255, 209');

    await expect(detail.locator('.public-media-comments__item')).toHaveCount(18);
    const initialBodies = await detail.locator('.public-media-comments__item p').allTextContents();
    expect(initialBodies.slice(0, 2)).toEqual(['Newest existing comment', 'Older existing comment 1']);

    const verticalOrder = await detail.evaluate(() => {
      const formRect = document.querySelector('.public-media-comments__form')?.getBoundingClientRect();
      const listRect = document.querySelector('.public-media-comments__list')?.getBoundingClientRect();
      const card = document.querySelector('#galleryModal .modal-card--public-detail');
      const list = document.querySelector('.public-media-comments__list');
      return {
        formTop: formRect?.top || 0,
        listTop: listRect?.top || 0,
        cardHeight: card?.getBoundingClientRect().height || 0,
        listScrollsInternally: Boolean(list && list.scrollHeight > list.clientHeight),
      };
    });
    expect(verticalOrder.formTop).toBeLessThan(verticalOrder.listTop);
    expect(verticalOrder.listScrollsInternally).toBe(true);

    await input.fill('Fresh posted comment');
    await submit.click();
    await expect.poll(() => postedBodies).toEqual(['Fresh posted comment']);
    await expect(detail.getByRole('tab', { name: 'Comments (19)' })).toBeVisible();
    const postedBodiesRendered = await detail.locator('.public-media-comments__item p').allTextContents();
    expect(postedBodiesRendered.slice(0, 3)).toEqual([
      'Fresh posted comment',
      'Newest existing comment',
      'Older existing comment 1',
    ]);
    await expect(detail.locator('.public-media-comments__item').first().locator('.public-media-comments__meta')).toContainText('Posting Member');
    await expect(detail.locator('.public-media-comments__item').first().locator('time')).toBeVisible();
    const afterPostLayout = await detail.evaluate(() => {
      const card = document.querySelector('#galleryModal .modal-card--public-detail');
      const list = document.querySelector('.public-media-comments__list');
      return {
        cardHeight: card?.getBoundingClientRect().height || 0,
        listScrollsInternally: Boolean(list && list.scrollHeight > list.clientHeight),
      };
    });
    expect(Math.abs(afterPostLayout.cardHeight - verticalOrder.cardHeight)).toBeLessThanOrEqual(1);
    expect(afterPostLayout.listScrollsInternally).toBe(true);
  });

  test('Gallery and Sound Lab cleanup remove stale Exclusive admin references', () => {
    const adminHtml = fs.readFileSync(path.join(process.cwd(), 'admin/index.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(process.cwd(), 'js/pages/admin/main.js'), 'utf8');
    const adminReferenceViewsJs = fs.readFileSync(
      path.join(process.cwd(), 'js/pages/admin/reference-views.js'),
      'utf8',
    );
    const adminSource = `${adminHtml}\n${adminJs}\n${adminReferenceViewsJs}`;

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
    const rawPrompt = 'Raw prompt text should stay hidden from public Video Explore cards.';
    const rawDescription = 'A cinematic prompt description that should not be visible on Video Explore cards.';
    const manualVideoTitle = 'Manual Public Video Title';
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
                title: rawDescription,
                display_title: manualVideoTitle,
                asset_title: manualVideoTitle,
                prompt: rawPrompt,
                description: rawDescription,
                prompt_description: rawDescription,
                preview_text: rawPrompt,
                metadata: {
                  description: rawDescription,
                },
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
    const videoAvatarBox = await videoCard.locator('.public-media-meta__avatar').boundingBox();
    expect(videoAvatarBox).toBeTruthy();
    expect(videoAvatarBox.width).toBeLessThanOrEqual(34);
    expect(videoAvatarBox.height).toBeLessThanOrEqual(34);
    expect(Math.abs(videoAvatarBox.width - videoAvatarBox.height)).toBeLessThanOrEqual(1);
    await expect(videoCard.locator('.video-card__caption')).toHaveText('Published by Ada Member on 2026-04-14.');
    await expect(videoCard).not.toContainText(rawPrompt);
    await expect(videoCard).not.toContainText(rawDescription);
    await expect(videoCard).not.toContainText(manualVideoTitle);
    await expect(videoCard.locator('.video-card__subtitle')).toHaveCount(0);
    const videoAriaLabel = await videoCard.getAttribute('aria-label');
    expect(videoAriaLabel).not.toContain(rawPrompt);
    expect(videoAriaLabel).not.toContain(rawDescription);
    expect(videoAriaLabel).not.toContain(manualVideoTitle);
    const videoTitleAttribute = await videoCard.getAttribute('title');
    expect(videoTitleAttribute || '').not.toContain(rawPrompt);
    expect(videoTitleAttribute || '').not.toContain(rawDescription);
    expect(videoTitleAttribute || '').not.toContain(manualVideoTitle);
    const videoPreviewAlt = await videoCard.locator('.video-card__preview').getAttribute('alt');
    expect(videoPreviewAlt).not.toContain(rawPrompt);
    expect(videoPreviewAlt).not.toContain(rawDescription);
    expect(videoPreviewAlt).not.toContain(manualVideoTitle);
    await expect(videoCard.locator('.fav-star')).toHaveCount(0);
  });

  test('published Memvid cards without ready posters show a pending placeholder instead of a blank preview', async ({ page }) => {
    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'manual-upload-no-poster',
                slug: 'manual-upload-no-poster',
                title: 'Manual video without poster',
                caption: 'Published by Ada Member on 2026-05-28.',
                category: 'memvids',
                publisher: {
                  display_name: 'Ada Member',
                },
                file: {
                  url: '/api/gallery/memvids/manual-upload-no-poster/file',
                },
              },
            ],
          },
        }),
      });
    });
    await page.route('**/api/gallery/memvids/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');
    await switchHomepageCategory(page, 'video');

    const videoCard = page.locator('#videoGrid .video-card').first();
    await expect(videoCard.locator('.video-card__poster-state')).toBeVisible();
    await expect(videoCard.locator('.video-card__poster-state')).toContainText('Preview pending');
    await expect(videoCard.locator('.video-card__preview')).toHaveCount(0);
  });

  test('desktop Video Explore cards lazy-play muted BITBI previews on hover', async ({ page }) => {
    const videoRequests = [];
    const heroSlots = ['right_top', 'right_bottom', 'left_top', 'left_bottom'].map((slot, index) => ({
      slot,
      version: `vhoverhero${index + 1}`,
      title: `Hover fixture ${slot}`,
      source_type: 'admin_asset',
      file: {
        url: `/api/homepage/hero-videos/${slot}/vhoverhero${index + 1}/file`,
        mime_type: 'video/mp4',
        width: 720,
        height: 405,
        size_bytes: 1400000,
        duration_seconds: 6,
      },
      poster: {
        url: `/api/homepage/hero-videos/${slot}/vhoverhero${index + 1}/poster`,
        mime_type: 'image/webp',
        width: 720,
        height: 405,
        size_bytes: 90000,
      },
    }));
    const items = Array.from({ length: 3 }, (_, index) => {
      const id = `hover-memvid-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Hover Cut ${index + 1}`,
        caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
        category: 'memvids',
        publisher: { display_name: 'Ada Member' },
        file: {
          url: `/api/gallery/memvids/${id}/vpub/file`,
        },
        poster: {
          url: `/api/gallery/memvids/${id}/vpub/poster`,
          w: 1280,
          h: 720,
        },
        stream_preview: {
          provider: 'cloudflare_stream',
          uid: `hoverStreamUid${index + 1}`,
          autoplay_enabled: index !== 2,
          preview_duration_seconds: 5,
          max_loop_count: 3,
          playback: {
            mp4_url: `https://videodelivery.net/hoverStreamUid${index + 1}/downloads/default.mp4`,
            hls_url: `https://videodelivery.net/hoverStreamUid${index + 1}/manifest/video.m3u8`,
          },
        },
      };
    });
    const memvidFileRequests = () => videoRequests.filter((pathname) => pathname.startsWith('/api/gallery/memvids/'));

    await page.addInitScript(() => {
      try {
        localStorage.removeItem('bitbi_audio_state_v1');
      } catch {
        // Ignore opaque initial documents; the real homepage origin will be cleared too.
      }
      HTMLMediaElement.prototype.play = function playMock() {
        this.dataset.playState = 'playing';
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function pauseMock() {
        this.dataset.playState = 'paused';
      };
      const nativeAddEventListener = HTMLMediaElement.prototype.addEventListener;
      HTMLMediaElement.prototype.addEventListener = function addEventListenerMock(type, listener, options) {
        if (type === 'error') {
          this.dataset.mockErrorHandlerSuppressed = 'true';
          return undefined;
        }
        return nativeAddEventListener.call(this, type, listener, options);
      };
    });
    await routeHomepageVideoHoverFixtures(page, {
      items,
      videoRequests,
      homepageHeroVideos: {
        ok: true,
        data: {
          configured: true,
          slots: heroSlots,
          slot_order: ['right_top', 'right_bottom', 'left_top', 'left_bottom'],
        },
      },
    });

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'video');

    const cards = page.locator('#videoGrid .video-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0).locator('.video-card__hover-preview')).toHaveCount(0);

    const firstCard = cards.nth(0);
    for (const pointerType of ['touch', 'pen', '']) {
      await firstCard.dispatchEvent('pointerenter', { pointerType });
      await expect(firstCard.locator('.video-card__hover-preview')).toHaveCount(0);
      await expect(firstCard).not.toHaveClass(/video-card--hover-preview-active/);
    }
    await firstCard.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    await page.waitForTimeout(50);
    expect(await firstCard.locator('.video-card__hover-preview').count()).toBe(0);
    const firstPreview = firstCard.locator('.video-card__hover-preview');
    await expect(firstPreview).toHaveCount(1);
    await expect(firstCard).not.toHaveClass(/video-card--hover-preview-active/);
    await firstPreview.dispatchEvent('loadeddata');
    await expect(firstCard).toHaveClass(/video-card--hover-preview-active/);
    const firstState = await firstPreview.evaluate((video) => ({
      ariaHidden: video.getAttribute('aria-hidden'),
      controls: video.controls,
      muted: video.muted,
      playsInline: video.playsInline,
      preload: video.preload,
      provider: video.dataset.previewProvider || '',
      maxLoopCount: video.dataset.maxLoopCount || '',
      playState: video.dataset.playState || '',
      src: video.getAttribute('src') || '',
    }));
    expect(firstState).toEqual({
      ariaHidden: 'true',
      controls: false,
      muted: true,
      playsInline: true,
      preload: 'none',
      provider: 'cloudflare_stream',
      maxLoopCount: '3',
      playState: 'playing',
      src: 'https://videodelivery.net/hoverStreamUid1/downloads/default.mp4',
    });
    expect(firstState.src).not.toMatch(/\/api\/gallery\/memvids\/[^/]+\/[^/]+\/file$/);
    expect(memvidFileRequests()).toEqual([]);

    for (let loop = 0; loop < 3; loop += 1) {
      await firstPreview.dispatchEvent('ended');
    }
    await expect(firstCard.locator('.video-card__hover-preview')).toHaveCount(0);
    await expect(firstCard).not.toHaveClass(/video-card--hover-preview-active/);

    const secondCard = cards.nth(1);
    await secondCard.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    const secondPreview = secondCard.locator('.video-card__hover-preview');
    await expect(secondPreview).toHaveCount(1);
    await expect(secondCard).not.toHaveClass(/video-card--hover-preview-active/);
    await secondPreview.dispatchEvent('loadeddata');
    await expect(secondCard).toHaveClass(/video-card--hover-preview-active/);
    await expect(firstCard).not.toHaveClass(/video-card--hover-preview-active/);
    await expect(secondPreview).toHaveAttribute('src', 'https://videodelivery.net/hoverStreamUid2/downloads/default.mp4');

    await secondCard.dispatchEvent('pointerleave', { pointerType: 'mouse' });
    await expect(secondCard).not.toHaveClass(/video-card--hover-preview-active/);
    await expect(secondCard.locator('.video-card__hover-preview')).toHaveCount(0);
    expect(memvidFileRequests()).toEqual([]);

    const thirdCard = cards.nth(2);
    await thirdCard.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    await expect(thirdCard.locator('.video-card__hover-preview')).toHaveCount(0);
    await expect(thirdCard).not.toHaveClass(/video-card--hover-preview-active/);
    expect(memvidFileRequests()).toEqual([]);

    await firstCard.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    await firstCard.click();
    await expect(page.locator('#videoModal')).toHaveClass(/active/);
    await expect(page.locator('#videoModalTitle')).toHaveText('Hover Cut 1');
    await expect(page.locator('#videoModal video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/hover-memvid-1\/vpub\/file$/);
    await expect(firstCard).not.toHaveClass(/video-card--hover-preview-active/);
    await expect(firstCard.locator('.video-card__hover-preview')).toHaveCount(0);
  });

  test('mobile Video Explore cards do not activate hover preview playback', async ({ page }) => {
    const videoRequests = [];
    const items = [
      {
        id: 'mobile-hover-memvid',
        slug: 'mobile-hover-memvid',
        title: 'Mobile Still Poster',
        caption: 'Touch devices keep the existing card behavior.',
        category: 'memvids',
        file: {
          url: '/api/gallery/memvids/mobile-hover-memvid/vpub/file',
        },
        poster: {
          url: '/api/gallery/memvids/mobile-hover-memvid/vpub/poster',
          w: 1280,
          h: 720,
        },
        stream_preview: {
          provider: 'cloudflare_stream',
          uid: 'mobileHoverStreamUid',
          preview_duration_seconds: 5,
          max_loop_count: 3,
          playback: {
            mp4_url: 'https://videodelivery.net/mobileHoverStreamUid/downloads/default.mp4',
            hls_url: 'https://videodelivery.net/mobileHoverStreamUid/manifest/video.m3u8',
          },
        },
      },
    ];

    await page.addInitScript(() => {
      localStorage.removeItem('bitbi_audio_state_v1');
      class MockAudio extends EventTarget {
        constructor() {
          super();
          this.preload = 'auto';
          this._src = '';
          this._crossOrigin = '';
          this._paused = true;
          this._currentTime = 0;
          this._duration = 245;
          this._volume = 0.8;
          this._muted = false;
          this._loop = false;
          this._playbackRate = 1;
          window.__bitbiSoundMoreAudioMock.instances.push(this);
        }

        get src() { return this._src; }
        set src(value) {
          this._src = String(value || '');
          if (this._src) {
            queueMicrotask(() => {
              this.dispatchEvent(new Event('loadedmetadata'));
              this.dispatchEvent(new Event('durationchange'));
              this.dispatchEvent(new Event('timeupdate'));
            });
          }
        }

        get crossOrigin() { return this._crossOrigin; }
        set crossOrigin(value) { this._crossOrigin = String(value || ''); }
        get paused() { return this._paused; }
        get currentTime() { return this._currentTime; }
        set currentTime(value) {
          this._currentTime = Number(value) || 0;
          this.dispatchEvent(new Event('timeupdate'));
        }
        get duration() { return this._duration; }
        get volume() { return this._volume; }
        set volume(value) {
          this._volume = Number(value) || 0;
          this.dispatchEvent(new Event('volumechange'));
        }
        get muted() { return this._muted; }
        set muted(value) {
          this._muted = !!value;
          this.dispatchEvent(new Event('volumechange'));
        }
        get loop() { return this._loop; }
        set loop(value) { this._loop = !!value; }
        get playbackRate() { return this._playbackRate; }
        set playbackRate(value) {
          this._playbackRate = Number(value) || 1;
          this.dispatchEvent(new Event('ratechange'));
        }

        play() {
          this._paused = false;
          window.__bitbiSoundMoreAudioMock.playCalls += 1;
          this.dispatchEvent(new Event('play'));
          return Promise.resolve();
        }

        pause() {
          this._paused = true;
          window.__bitbiSoundMoreAudioMock.pauseCalls += 1;
          this.dispatchEvent(new Event('pause'));
        }

        load() {
          if (!this._src) return;
          this.dispatchEvent(new Event('loadedmetadata'));
          this.dispatchEvent(new Event('durationchange'));
        }

        removeAttribute(name) {
          if (name === 'src') this._src = '';
          if (name === 'crossorigin') this._crossOrigin = '';
        }
      }

      window.__bitbiSoundMoreAudioMock = { playCalls: 0, pauseCalls: 0, instances: [] };
      window.Audio = MockAudio;
    });
    await routeHomepageVideoHoverFixtures(page, { items, videoRequests });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expectActiveHomepageCategory(page, 'video');

    const card = page.locator('#videoGrid .video-card').first();
    await expect(card).toBeVisible();
    for (const pointerType of ['touch', 'pen', 'mouse', '']) {
      await card.dispatchEvent('pointerenter', { pointerType });
      await expect(card.locator('.video-card__hover-preview')).toHaveCount(0);
      await expect(card).not.toHaveClass(/video-card--hover-preview-active/);
      expect(videoRequests).toEqual([]);
    }
    await card.hover({ force: true });
    await expect(card.locator('.video-card__hover-preview')).toHaveCount(0);
    await expect(card).not.toHaveClass(/video-card--hover-preview-active/);
    expect(videoRequests).toEqual([]);

    await card.click();
    await expect(page.locator('.mobile-media-detail-overlay--video.mobile-media-detail-overlay--standalone')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video video')).toHaveAttribute(
      'src',
      /\/api\/gallery\/memvids\/mobile-hover-memvid\/vpub\/file$/,
    );
    await expect(page.locator('#videoModal.active')).toHaveCount(0);
  });

  test('desktop published Mempics and Memvids start at two rows without changing mobile behavior', async ({ page }) => {
    const overlayAspectFixtures = [
      { w: 720, h: 1280, ratio: 720 / 1280 },
      { w: 1280, h: 720, ratio: 1280 / 720 },
      { w: 900, h: 900, ratio: 1 },
    ];
    const mempicItems = Array.from({ length: 12 }, (_, index) => ({
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
        w: overlayAspectFixtures[index % overlayAspectFixtures.length].w,
        h: overlayAspectFixtures[index % overlayAspectFixtures.length].h,
      },
      preview: {
        url: `/api/gallery/mempics/mempic-${index + 1}/medium`,
        w: overlayAspectFixtures[index % overlayAspectFixtures.length].w,
        h: overlayAspectFixtures[index % overlayAspectFixtures.length].h,
      },
      full: {
        url: `/api/gallery/mempics/mempic-${index + 1}/file`,
      },
    }));

    const memvidItems = Array.from({ length: 12 }, (_, index) => ({
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
        w: index % 3 === 0 ? 720 : index % 3 === 1 ? 1280 : 900,
        h: index % 3 === 0 ? 1280 : index % 3 === 1 ? 720 : 900,
      },
    }));

    const memtrackItems = Array.from({ length: 12 }, (_, index) => ({
      id: `memtrack-${index + 1}`,
      slug: `memtrack-${index + 1}`,
      title: `Public Member Track ${index + 1}`,
      caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
      category: 'memtracks',
      model_label: 'Music 2.6',
      publisher: {
        display_name: 'Ada Member',
      },
      file: {
        url: `/api/gallery/memtracks/memtrack-${index + 1}/file`,
      },
      poster: {
        url: `/api/gallery/memtracks/memtrack-${index + 1}/poster`,
        w: overlayAspectFixtures[index % overlayAspectFixtures.length].w,
        h: overlayAspectFixtures[index % overlayAspectFixtures.length].h,
      },
    }));

    const expectActiveDeckIndex = async (gridSelector, cardSelector, expectedIndex) => {
      const index = await page.evaluate(({ gridSelector, cardSelector }) => (
        Array.from(document.querySelectorAll(`${gridSelector} ${cardSelector}`)).findIndex((card) => {
          const style = window.getComputedStyle(card);
          return style.pointerEvents !== 'none';
        })
      ), { gridSelector, cardSelector });
      expect(index).toBe(expectedIndex);
    };

    const swipeToDeckIndex = async (gridSelector, cardSelector, expectedIndex) => {
      for (let index = 0; index < expectedIndex; index += 1) {
        await dispatchHorizontalTouchSwipe(page, gridSelector);
      }
      await expectActiveDeckIndex(gridSelector, cardSelector, expectedIndex);
    };

    const expectCappedDots = async (selector, expectedCount = 10) => {
      const dots = page.locator(selector);
      await expect(dots).toHaveCount(expectedCount);
      const metrics = await dots.first().evaluate((dot) => {
        const node = dot.parentElement;
        return {
          dotCount: node?.querySelectorAll('button').length || 0,
          activeCount: node?.querySelectorAll('button.active').length || 0,
          scrollWidth: node?.scrollWidth || 0,
          clientWidth: node?.clientWidth || 0,
          selectedTargets: Array.from(node?.querySelectorAll('button[aria-selected="true"]') || []).map((selectedDot) => selectedDot.dataset.targetIndex || ''),
        };
      });
      expect(metrics.dotCount).toBeLessThanOrEqual(10);
      expect(metrics.activeCount).toBe(1);
      expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
      return metrics;
    };

    const expectMobileOverlayGrid = async ({
      overlayClass,
      expectedCount,
      expectedRatios,
    }) => {
      const overlay = page.locator(`.mobile-media-grid-overlay${overlayClass}`);
      await expect(overlay).toBeVisible();
      await expect(overlay.locator('.mobile-media-grid-overlay__item')).toHaveCount(expectedCount);
      const metrics = await overlay.locator('.mobile-media-grid-overlay__grid').evaluate((grid, ratioCount) => {
        const style = window.getComputedStyle(grid);
        const items = Array.from(grid.querySelectorAll('.mobile-media-grid-overlay__item'));
        const shell = grid.closest('.mobile-media-grid-overlay__shell') || grid;
        const columnGroups = [];
        items.forEach((item) => {
          const rect = item.getBoundingClientRect();
          let group = columnGroups.find((candidate) => Math.abs(candidate.left - rect.left) < 2);
          if (!group) {
            group = { left: rect.left, rects: [] };
            columnGroups.push(group);
          }
          group.rects.push(rect);
        });
        const columnMaxGaps = columnGroups.map((group) => {
          const rects = group.rects.slice().sort((first, second) => first.top - second.top);
          return rects.slice(1).reduce((maxGap, rect, index) => (
            Math.max(maxGap, rect.top - rects[index].bottom)
          ), 0);
        });
        return {
          display: style.display,
          columnCount: style.columnCount,
          visualColumns: columnGroups.length,
          maxVerticalGap: columnMaxGaps.length ? Math.max(...columnMaxGaps) : 0,
          overflow: shell.scrollWidth - shell.clientWidth,
          ratios: items.slice(0, ratioCount).map((item) => {
            const rect = item.getBoundingClientRect();
            const itemStyle = window.getComputedStyle(item);
            const img = item.querySelector('img');
            return {
              rectRatio: rect.height > 0 ? rect.width / rect.height : 0,
              cssRatio: Number.parseFloat(itemStyle.getPropertyValue('--mobile-media-grid-item-aspect')) || 0,
              objectFit: img ? window.getComputedStyle(img).objectFit : '',
            };
          }),
        };
      }, expectedRatios.length);
      expect(metrics.display).toBe('block');
      expect(metrics.columnCount).toBe('2');
      expect(metrics.visualColumns).toBe(2);
      expect(metrics.maxVerticalGap).toBeLessThanOrEqual(10);
      expect(metrics.overflow).toBeLessThanOrEqual(1);
      metrics.ratios.forEach((ratio, index) => {
        expectWithinPx(ratio.rectRatio, expectedRatios[index], `${overlayClass} overlay item ${index + 1} rendered aspect`, 0.04);
        expectWithinPx(ratio.cssRatio, expectedRatios[index], `${overlayClass} overlay item ${index + 1} CSS aspect`, 0.001);
        expect(ratio.objectFit).toBe('cover');
      });
    };

    const expectPublicMobileDetailChrome = async (overlaySelector, { closeText = '' } = {}) => {
      const overlay = page.locator(overlaySelector);
      await expect(overlay.locator('.mobile-media-detail-overlay__title')).toHaveCount(0);
      await expect(overlay.locator('.mobile-media-detail-overlay__open-original')).toHaveCount(0);
      const close = overlay.locator('.mobile-media-detail-overlay__close');
      await expect(close).toBeVisible();
      if (closeText) await expect(close).toHaveText(closeText);
      const verticalGap = await overlay.evaluate((node) => {
        const controls = node.querySelector('.mobile-media-detail-overlay__controls');
        const media = node.querySelector('.mobile-media-detail-overlay__media, .mobile-media-detail-overlay__sound');
        if (!controls || !media) return null;
        return media.getBoundingClientRect().top - controls.getBoundingClientRect().bottom;
      });
      expect(verticalGap).not.toBeNull();
      expect(verticalGap).toBeLessThanOrEqual(16);
    };

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

    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: memtrackItems,
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

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');

    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();
    await expect.poll(() => page.locator('#galleryGrid .gallery-item:visible').count()).toBeGreaterThanOrEqual(10);
    const galleryInitialCount = await page.locator('#galleryGrid .gallery-item:visible').count();
    expect(galleryInitialCount).toBeLessThanOrEqual(12);
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText(
      galleryInitialCount >= 12 ? 'Showing all 12 Mempics.' : `Showing ${galleryInitialCount} Mempics.`,
    );
    await expect(page.locator('#galleryGrid .gallery-item:visible').first().locator('.public-media-meta__avatar')).toHaveCount(0);

    const galleryToggle = page.locator('#galleryPagination .browse-pagination__toggle');
    if (galleryInitialCount < 12) {
      await expect(galleryToggle).toHaveAttribute('aria-expanded', 'false');
      await galleryToggle.scrollIntoViewIfNeeded();
      const galleryScrollBefore = await page.evaluate(() => window.scrollY);
      await galleryToggle.click();
      await expect.poll(() => page.locator('#galleryGrid .gallery-item:visible').count()).toBe(12);
      const galleryScrollAfter = await page.evaluate(() => window.scrollY);
      expect(galleryScrollAfter).toBeGreaterThanOrEqual(galleryScrollBefore - 1);
    }
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing all 12 Mempics.');
    await expect(page.locator('#galleryPagination .browse-pagination__btn')).toBeHidden();
    await expect(galleryToggle).toBeHidden();

    await switchHomepageCategory(page, 'video');
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();
    await expect.poll(() => page.locator('#videoGrid .video-card:visible').count()).toBeGreaterThanOrEqual(10);
    const videoInitialCount = await page.locator('#videoGrid .video-card:visible').count();
    expect(videoInitialCount).toBeLessThanOrEqual(12);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText(
      videoInitialCount >= 12 ? 'Showing all 12 Memvids.' : `Showing ${videoInitialCount} Memvids.`,
    );

    const videoToggle = page.locator('#videoPagination .browse-pagination__toggle');
    if (videoInitialCount < 12) {
      await expect(videoToggle).toHaveAttribute('aria-expanded', 'false');
      await videoToggle.scrollIntoViewIfNeeded();
      const videoScrollBefore = await page.evaluate(() => window.scrollY);
      await videoToggle.click();
      await expect.poll(() => page.locator('#videoGrid .video-card:visible').count()).toBe(12);
      const videoScrollAfter = await page.evaluate(() => window.scrollY);
      expect(videoScrollAfter).toBeGreaterThanOrEqual(videoScrollBefore - 1);
    }
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing all 12 Memvids.');
    await expect(page.locator('#videoPagination .browse-pagination__btn')).toBeHidden();
    await expect(videoToggle).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await switchHomepageCategory(page, 'gallery');
    await expectCappedDots('.gal-deck-dots .gal-deck-dot');
    const galleryPreviewShape = await page.locator('#galleryGrid .gallery-item:not(.locked-area)').first().evaluate((card) => {
      const preview = card.querySelector('.gallery-inner');
      const image = card.querySelector('.gallery-item__media');
      const previewRect = preview.getBoundingClientRect();
      const imageStyle = getComputedStyle(image);
      return {
        width: Math.round(previewRect.width * 100) / 100,
        height: Math.round(previewRect.height * 100) / 100,
        objectFit: imageStyle.objectFit,
        radius: getComputedStyle(preview).borderRadius,
      };
    });
    expectWithinPx(galleryPreviewShape.width, galleryPreviewShape.height, 'mobile Gallery preview square', 1);
    expect(galleryPreviewShape.objectFit).toBe('cover');
    expect(galleryPreviewShape.radius).not.toBe('0px');
    const firstGalleryCard = page.locator('#galleryGrid .gallery-item:not(.locked-area)').first();
    const galleryMobileMeta = await firstGalleryCard.evaluate((card) => {
      const overlay = card.querySelector('.gallery-overlay');
      const title = card.querySelector('.public-media-meta__title');
      const caption = card.querySelector('.public-media-meta__caption');
      const cta = card.querySelector('.public-media-meta__cta');
      const inner = card.querySelector('.gallery-inner');
      return {
        overlayOpacity: overlay ? getComputedStyle(overlay).opacity : '',
        overlayPointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : '',
        title: title?.textContent?.trim() || '',
        caption: caption?.textContent?.trim() || '',
        cta: cta?.textContent?.trim() || '',
        transform: inner ? getComputedStyle(inner).transform : '',
      };
    });
    expect(galleryMobileMeta.overlayOpacity).toBe('1');
    expect(galleryMobileMeta.overlayPointerEvents).toBe('none');
    expect(galleryMobileMeta.title).toBe('Ada Member');
    expect(galleryMobileMeta.caption).toContain('Published by Ada Member');
    expect(galleryMobileMeta.cta).toBe('View Full →');
    await firstGalleryCard.click();
    await expect(page.locator('.mobile-media-detail-overlay--gallery.mobile-media-detail-overlay--standalone')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--gallery .public-media-detail-panel')).toBeVisible();
    await expectPublicMobileDetailChrome('.mobile-media-detail-overlay--gallery', { closeText: 'Close' });
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);
    const directGalleryDetailLayout = await page.locator('.mobile-media-detail-overlay--gallery').evaluate((overlay) => {
      const media = overlay.querySelector('.mobile-media-detail-overlay__media');
      const details = overlay.querySelector('.mobile-media-detail-overlay__details');
      const mediaRect = media.getBoundingClientRect();
      const detailsRect = details.getBoundingClientRect();
      return {
        mediaBottom: mediaRect.bottom,
        detailsTop: detailsRect.top,
        imageFit: getComputedStyle(media.querySelector('img')).objectFit,
      };
    });
    expect(directGalleryDetailLayout.detailsTop).toBeGreaterThanOrEqual(directGalleryDetailLayout.mediaBottom - 1);
    expect(directGalleryDetailLayout.imageFit).toBe('contain');
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
    await swipeToDeckIndex('#galleryGrid', '.gallery-item:not(.locked-area)', 11);
    const galleryDotState = await expectCappedDots('.gal-deck-dots .gal-deck-dot');
    expect(galleryDotState.selectedTargets).toEqual(['11']);
    await expect(page.locator('#galleryPagination .browse-pagination__toggle')).toBeHidden();
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toBeEnabled();
    await page.locator('#galleryPagination .browse-pagination__status').click();
    await expectMobileOverlayGrid({
      overlayClass: '--gallery',
      expectedCount: 12,
      expectedRatios: overlayAspectFixtures.map((item) => item.ratio),
    });
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--gallery')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--gallery .public-media-detail-panel')).toBeVisible();
    await expectPublicMobileDetailChrome('.mobile-media-detail-overlay--gallery', { closeText: 'Back' });
    await expect(page.locator('#galleryModal')).not.toHaveClass(/active/);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
    await expect(page.locator('a[href*="/api/gallery/mempics/"]')).toHaveCount(0);
    await page.locator('.mobile-media-grid-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toHaveCount(0);
    await expect(page.locator('a[href*="/api/gallery/mempics/"]')).toHaveCount(0);

    await switchHomepageCategory(page, 'video');
    await expectCappedDots('.vid-deck-dots .vid-deck-dot');
    const videoPreviewShape = await page.locator('#videoGrid .video-card').first().evaluate((card) => {
      const preview = card.querySelector('.video-card__poster');
      const media = card.querySelector('.video-card__preview');
      const previewRect = preview.getBoundingClientRect();
      const mediaStyle = media ? getComputedStyle(media) : null;
      return {
        width: Math.round(previewRect.width * 100) / 100,
        height: Math.round(previewRect.height * 100) / 100,
        objectFit: mediaStyle?.objectFit || '',
        radius: getComputedStyle(preview).borderRadius,
      };
    });
    expectWithinPx(videoPreviewShape.width, videoPreviewShape.height, 'mobile Video preview square', 1);
    expect(videoPreviewShape.objectFit).toBe('cover');
    expect(videoPreviewShape.radius).not.toBe('0px');
    await page.locator('#videoGrid .video-card').first().click();
    await expect(page.locator('.mobile-media-detail-overlay--video.mobile-media-detail-overlay--standalone')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video .public-media-detail-panel')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video video')).toHaveCSS('object-fit', 'contain');
    await expectPublicMobileDetailChrome('.mobile-media-detail-overlay--video', { closeText: 'Close' });
    await expect(page.locator('#videoModal.active')).toHaveCount(0);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
    await swipeToDeckIndex('#videoGrid', '.video-card', 11);
    const videoDotState = await expectCappedDots('.vid-deck-dots .vid-deck-dot');
    expect(videoDotState.selectedTargets).toEqual(['11']);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toBeEnabled();
    await page.locator('#videoPagination .browse-pagination__status').click();
    await expectMobileOverlayGrid({
      overlayClass: '--video',
      expectedCount: 12,
      expectedRatios: overlayAspectFixtures.map((item) => item.ratio),
    });
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video .public-media-detail-panel')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/memvid-1\/file/);
    await expectPublicMobileDetailChrome('.mobile-media-detail-overlay--video', { closeText: 'Back' });
    await expect(page.locator('#videoModal.active')).toHaveCount(0);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await page.locator('.mobile-media-grid-overlay__close').click();

    await switchHomepageCategory(page, 'sound');
    await expectCappedDots('.snd-deck-dots .snd-deck-dot');
    await page.locator('#soundLabTracks .snd-card--memtrack .snd-hero').first().click();
    await expect(page.locator('.mobile-media-detail-overlay--sound.mobile-media-detail-overlay--standalone')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--sound .public-media-detail-panel')).toBeVisible();
    await expectPublicMobileDetailChrome('.mobile-media-detail-overlay--sound', { closeText: 'Close' });
    await expect(page.locator('#memtrackModal.active')).toHaveCount(0);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
    await swipeToDeckIndex('#soundLabTracks', '.snd-card--memtrack', 11);
    const soundDotState = await expectCappedDots('.snd-deck-dots .snd-deck-dot');
    expect(soundDotState.selectedTargets).toEqual(['11']);
    await expect(page.locator('.snd-memtracks-pagination .browse-pagination__status')).toHaveText('Showing all 12 Memtracks.');
    await expect(page.locator('.snd-memtracks-pagination .browse-pagination__status')).toBeEnabled();
    await page.locator('.snd-memtracks-pagination .browse-pagination__status').click();
    await expectMobileOverlayGrid({
      overlayClass: '--sound',
      expectedCount: 12,
      expectedRatios: overlayAspectFixtures.map((item) => item.ratio),
    });
    await page.locator('.mobile-media-grid-overlay__item').first().click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--sound')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay__sound-title')).toHaveText('Public Member Track 1');
    await expect(page.locator('.mobile-media-detail-overlay--sound .public-media-detail-panel')).toBeVisible();
    await expectPublicMobileDetailChrome('.mobile-media-detail-overlay--sound', { closeText: 'Back' });
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-grid-overlay')).toBeVisible();
    await page.locator('.mobile-media-grid-overlay__close').click();
  });

  test('homepage Gallery and Video use stable masonry media walls on wide desktop while preserving the mobile layout', async ({ page }) => {
    const dimensions = [
      { w: 360, h: 540 },
      { w: 720, h: 405 },
      { w: 440, h: 440 },
      { w: 420, h: 620 },
      { w: 640, h: 420 },
      { w: 520, h: 700 },
      { w: 560, h: 560 },
      { w: 800, h: 450 },
      { w: 380, h: 580 },
      { w: 700, h: 430 },
      { w: 900, h: 520 },
    ];
    const items = Array.from({ length: 11 }, (_, index) => {
      const id = `mempic-${index + 1}`;
      const size = dimensions[index];
      return {
        id,
        slug: id,
        title: `Mempics ${index + 1}`,
        created_at: `2026-05-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
        caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
        category: 'mempics',
        thumb: {
          url: `/api/gallery/mempics/${id}/thumb`,
          w: size.w,
          h: size.h,
        },
        preview: {
          url: `/api/gallery/mempics/${id}/medium`,
          w: size.w * 2,
          h: size.h * 2,
        },
        full: {
          url: `/api/gallery/mempics/${id}/file`,
        },
      };
    });
    const videoDimensions = [
      { w: 720, h: 1280 },
      { w: 1280, h: 720 },
      { w: 900, h: 900 },
      { w: 720, h: 1180 },
      { w: 1280, h: 760 },
      { w: 720, h: 1280 },
      { w: 960, h: 960 },
      { w: 1280, h: 720 },
      { w: 720, h: 1200 },
      { w: 1280, h: 800 },
      { w: 1280, h: 720 },
    ];
    const videoItems = Array.from({ length: 11 }, (_, index) => {
      const id = `memvid-${index + 1}`;
      const size = videoDimensions[index];
      return {
        id,
        slug: id,
        title: `Launch Cut ${index + 1}`,
        created_at: `2026-05-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
        caption: `Published by Ada Member on 2026-04-${String(index + 10).padStart(2, '0')}.`,
        category: 'memvids',
        file: {
          url: `/api/gallery/memvids/${id}/file`,
        },
        poster: {
          url: `/api/gallery/memvids/${id}/poster`,
          w: size.w,
          h: size.h,
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
      const requestUrl = new URL(route.request().url());
      const item = items.find((candidate) => requestUrl.pathname.includes(`/${candidate.id}/`));
      const dimensions = requestUrl.pathname.endsWith('/thumb')
        ? item?.thumb
        : item?.preview || item?.thumb;
      const width = Number(dimensions?.w) || 1;
      const height = Number(dimensions?.h) || 1;
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#001018"/></svg>`,
      });
    });

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { items: videoItems },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
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

    const galleryCards = page.locator('#galleryGrid .gallery-item:not(.locked-area)');
    await expect.poll(() => galleryCards.count()).toBeGreaterThanOrEqual(10);
    await expect(galleryCards.first()).toBeVisible();
    await waitForFixedMediaWallReady(page, '#galleryGrid', '.gallery-item:not(.locked-area)', 294);

    const wideLayout = await page.evaluate(() => {
      const grid = document.getElementById('galleryGrid');
      const style = window.getComputedStyle(grid);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const parseCssLength = (value, fallback) => {
        const text = String(value || '').trim();
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) return fallback;
        if (text.endsWith('rem')) return parsed * rootFontSize;
        if (text.endsWith('px')) return parsed;
        return parsed;
      };
      const rects = Array.from(grid.querySelectorAll('.gallery-item:not(.locked-area)')).map((node) => {
        const rect = node.getBoundingClientRect();
        const nodeStyle = window.getComputedStyle(node);
        const media = node.querySelector('.gallery-item__media');
        const mediaRect = media?.getBoundingClientRect();
        return {
          id: node.dataset.galleryItemId || '',
          aspect: node.dataset.galleryAspect || '',
          cssAspect: Number.parseFloat(nodeStyle.getPropertyValue('--gallery-item-aspect')) || 0,
          mediaSrc: media?.getAttribute('src') || '',
          mediaNaturalWidth: media?.naturalWidth || 0,
          mediaNaturalHeight: media?.naturalHeight || 0,
          mediaAttrWidth: media?.getAttribute('width') || '',
          mediaAttrHeight: media?.getAttribute('height') || '',
          left: Math.round(rect.left * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          mediaWidth: mediaRect ? Math.round(mediaRect.width * 100) / 100 : 0,
          mediaHeight: mediaRect ? Math.round(mediaRect.height * 100) / 100 : 0,
          mediaCoverage: mediaRect ? Math.round(((mediaRect.width * mediaRect.height) / (rect.width * rect.height)) * 1000) / 1000 : 0,
        };
      });
      const columns = [];
      rects.forEach((rect) => {
        let column = columns.find((candidate) => Math.abs(candidate.left - rect.left) <= 3);
        if (!column) {
          column = { left: rect.left, cards: [] };
          columns.push(column);
        }
        column.cards.push(rect);
      });
      columns.sort((a, b) => a.left - b.left);
      columns.forEach((column) => column.cards.sort((a, b) => a.top - b.top));
      const horizontalGaps = columns.slice(1).map((column, index) => {
        const previousRight = Math.max(...columns[index].cards.map((rect) => rect.right));
        return Math.round((column.left - previousRight) * 100) / 100;
      });
      const verticalGaps = columns.flatMap((column) => column.cards.slice(1).map((rect, index) => (
        Math.round((rect.top - column.cards[index].bottom) * 100) / 100
      )));
      const topLeft = [...rects].sort((a, b) => (a.top - b.top) || (a.left - b.left))[0];
      return {
        display: style.display,
        cssColumnCount: columns.length,
        overflow: grid.scrollWidth - grid.clientWidth,
        renderedCount: rects.length,
        averageWidth: rects.reduce((sum, rect) => sum + rect.width, 0) / Math.max(rects.length, 1),
        targetWidth: Number(grid.dataset.mediaWallResolvedWidth)
          || parseCssLength(style.getPropertyValue('--bitbi-public-media-wall-resolved-column-width'), 297),
        baseWidth: Number(grid.dataset.mediaWallBaseWidth)
          || parseCssLength(style.getPropertyValue('--bitbi-public-gallery-active-column-width'), 297),
        targetGap: Number(grid.dataset.mediaWallGap)
          || parseCssLength(style.getPropertyValue('--bitbi-public-media-gap') || style.columnGap, 2),
        orderedIds: rects.map((rect) => rect.id),
        topLeftId: topLeft?.id || '',
        columnCounts: columns.map((column) => column.cards.length),
        horizontalGaps,
        maxVerticalGap: verticalGaps.length ? Math.max(...verticalGaps) : 0,
        minMediaCoverage: Math.min(...rects.map((rect) => rect.mediaCoverage)),
        portrait: rects.find((rect) => rect.aspect === 'portrait') || null,
        landscape: rects.find((rect) => rect.aspect === 'landscape') || null,
        square: rects.find((rect) => rect.aspect === 'square') || null,
        roundedHeights: Array.from(new Set(rects.map((rect) => Math.round(rect.height / 10) * 10))),
      };
    });

    expect(wideLayout.display).toBe('grid');
    expect(wideLayout.cssColumnCount).toBeGreaterThanOrEqual(4);
    expect(wideLayout.overflow).toBeLessThanOrEqual(2);
    expect(wideLayout.renderedCount).toBeGreaterThanOrEqual(10);
    expect(wideLayout.renderedCount).toBeLessThanOrEqual(items.length);
    expect(wideLayout.baseWidth).toBeGreaterThanOrEqual(294);
    expect(wideLayout.targetWidth).toBeGreaterThanOrEqual(wideLayout.baseWidth);
    expect(Math.abs(wideLayout.averageWidth - wideLayout.targetWidth)).toBeLessThanOrEqual(2);
    expect(wideLayout.orderedIds).toContain('mempic-11');
    expect(wideLayout.topLeftId).toBe('mempic-11');
    expect(wideLayout.columnCounts.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...wideLayout.columnCounts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...wideLayout.horizontalGaps)).toBeLessThanOrEqual(wideLayout.targetGap + 3);
    expect(Math.max(...wideLayout.horizontalGaps) - Math.min(...wideLayout.horizontalGaps)).toBeLessThanOrEqual(2);
    expect(wideLayout.maxVerticalGap).toBeLessThanOrEqual(wideLayout.targetGap + 3);
    expect(wideLayout.minMediaCoverage).toBeGreaterThan(0.95);
    expect(wideLayout.portrait.aspect).toBe('portrait');
    expect(wideLayout.portrait.cssAspect).toBeLessThan(0.9);
    expect(wideLayout.landscape.aspect).toBe('landscape');
    expect(wideLayout.landscape.cssAspect).toBeGreaterThan(1.1);
    expect(wideLayout.square.aspect).toBe('square');
    expect(Math.abs(wideLayout.square.cssAspect - 1)).toBeLessThanOrEqual(0.01);
    expect(wideLayout.roundedHeights.length).toBeGreaterThanOrEqual(3);

    await switchHomepageCategory(page, 'video');
    const videoCards = page.locator('#videoGrid .video-card');
    await expect.poll(() => videoCards.count()).toBeGreaterThanOrEqual(10);
    await expect(videoCards.first()).toBeVisible();
    await waitForFixedMediaWallReady(page, '#videoGrid', '.video-card', 294);

    const videoLayout = await page.evaluate(() => {
      const grid = document.getElementById('videoGrid');
      const style = window.getComputedStyle(grid);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const parseCssLength = (value, fallback) => {
        const text = String(value || '').trim();
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) return fallback;
        if (text.endsWith('rem')) return parsed * rootFontSize;
        if (text.endsWith('px')) return parsed;
        return parsed;
      };
      const rects = Array.from(grid.querySelectorAll('.video-card')).map((node) => {
        const rect = node.getBoundingClientRect();
        const nodeStyle = window.getComputedStyle(node);
        const media = node.querySelector('.video-card__preview');
        const mediaRect = media?.getBoundingClientRect();
        return {
          id: node.dataset.videoItemId || '',
          aspect: node.dataset.videoAspect || '',
          cssAspect: Number.parseFloat(nodeStyle.getPropertyValue('--video-item-aspect')) || 0,
          left: Math.round(rect.left * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          mediaWidth: mediaRect ? Math.round(mediaRect.width * 100) / 100 : 0,
          mediaHeight: mediaRect ? Math.round(mediaRect.height * 100) / 100 : 0,
          mediaCoverage: mediaRect ? Math.round(((mediaRect.width * mediaRect.height) / (rect.width * rect.height)) * 1000) / 1000 : 0,
        };
      });
      const columns = [];
      rects.forEach((rect) => {
        let column = columns.find((candidate) => Math.abs(candidate.left - rect.left) <= 3);
        if (!column) {
          column = { left: rect.left, cards: [] };
          columns.push(column);
        }
        column.cards.push(rect);
      });
      columns.sort((a, b) => a.left - b.left);
      columns.forEach((column) => column.cards.sort((a, b) => a.top - b.top));
      const horizontalGaps = columns.slice(1).map((column, index) => {
        const previousRight = Math.max(...columns[index].cards.map((rect) => rect.right));
        return Math.round((column.left - previousRight) * 100) / 100;
      });
      const verticalGaps = columns.flatMap((column) => column.cards.slice(1).map((rect, index) => (
        Math.round((rect.top - column.cards[index].bottom) * 100) / 100
      )));
      const topLeft = [...rects].sort((a, b) => (a.top - b.top) || (a.left - b.left))[0];
      return {
        display: style.display,
        cssColumnCount: columns.length,
        overflow: grid.scrollWidth - grid.clientWidth,
        viewportWidth: window.innerWidth,
        averageWidth: rects.reduce((sum, rect) => sum + rect.width, 0) / Math.max(rects.length, 1),
        targetWidth: Number(grid.dataset.mediaWallResolvedWidth)
          || parseCssLength(style.getPropertyValue('--bitbi-public-media-wall-resolved-column-width'), 297),
        baseWidth: Number(grid.dataset.mediaWallBaseWidth)
          || parseCssLength(style.getPropertyValue('--bitbi-public-video-active-column-width'), 297),
        targetGap: Number(grid.dataset.mediaWallGap)
          || parseCssLength(style.getPropertyValue('--bitbi-public-media-gap') || style.columnGap, 2),
        orderedIds: rects.map((rect) => rect.id),
        topLeftId: topLeft?.id || '',
        columnCounts: columns.map((column) => column.cards.length),
        lastColumn: columns.length ? {
          left: columns[columns.length - 1].left,
          right: Math.max(...columns[columns.length - 1].cards.map((rect) => rect.right)),
          width: columns[columns.length - 1].cards[0]?.width || 0,
        } : null,
        horizontalGaps,
        maxVerticalGap: verticalGaps.length ? Math.max(...verticalGaps) : 0,
        minMediaCoverage: Math.min(...rects.map((rect) => rect.mediaCoverage)),
        portrait: rects.find((rect) => rect.aspect === 'portrait') || null,
        landscape: rects.find((rect) => rect.aspect === 'landscape') || null,
        square: rects.find((rect) => rect.aspect === 'square') || null,
        roundedHeights: Array.from(new Set(rects.map((rect) => Math.round(rect.height / 10) * 10))),
      };
    });

    expect(videoLayout.display).toBe('grid');
    expect(videoLayout.cssColumnCount).toBeGreaterThanOrEqual(4);
    expect(videoLayout.overflow).toBeLessThanOrEqual(2);
    expect(videoLayout.baseWidth).toBeGreaterThanOrEqual(294);
    expect(videoLayout.targetWidth).toBeGreaterThanOrEqual(videoLayout.baseWidth);
    expect(Math.abs(videoLayout.averageWidth - videoLayout.targetWidth)).toBeLessThanOrEqual(2);
    expect(videoLayout.orderedIds).toContain('memvid-11');
    expect(videoLayout.topLeftId).toBe('memvid-11');
    expect(videoLayout.columnCounts.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...videoLayout.columnCounts)).toBeGreaterThanOrEqual(1);
    expect(videoLayout.columnCounts.at(-1)).toBeGreaterThanOrEqual(1);
    expect(videoLayout.lastColumn.width).toBeGreaterThan(150);
    expect(videoLayout.lastColumn.left).toBeLessThan(videoLayout.viewportWidth - 180);
    expect(videoLayout.lastColumn.right).toBeLessThanOrEqual(videoLayout.viewportWidth + 2);
    expect(Math.max(...videoLayout.horizontalGaps)).toBeLessThanOrEqual(videoLayout.targetGap + 3);
    expect(Math.max(...videoLayout.horizontalGaps) - Math.min(...videoLayout.horizontalGaps)).toBeLessThanOrEqual(2);
    expect(videoLayout.maxVerticalGap).toBeLessThanOrEqual(videoLayout.targetGap + 3);
    expect(videoLayout.minMediaCoverage).toBeGreaterThan(0.95);
    expect(videoLayout.portrait.aspect).toBe('portrait');
    expect(videoLayout.portrait.cssAspect).toBeLessThan(0.9);
    expect(videoLayout.landscape.aspect).toBe('landscape');
    expect(videoLayout.landscape.cssAspect).toBeGreaterThan(1.1);
    expect(videoLayout.square.aspect).toBe('square');
    expect(Math.abs(videoLayout.square.cssAspect - 1)).toBeLessThanOrEqual(0.01);
    expect(videoLayout.roundedHeights.length).toBeGreaterThanOrEqual(3);

    await page.setViewportSize({ width: 390, height: 844 });

    const mobileLayout = await page.evaluate(() => {
      const grid = document.getElementById('galleryGrid');
      const style = window.getComputedStyle(grid);
      return style.gridTemplateColumns.split(' ').filter(Boolean).length;
    });

    expect(mobileLayout).toBe(1);

    await switchHomepageCategory(page, 'video');
    const mobileVideoLayout = await page.evaluate(() => {
      const grid = document.getElementById('videoGrid');
      const style = window.getComputedStyle(grid);
      return style.gridTemplateColumns.split(' ').filter(Boolean).length;
    });

    expect(mobileVideoLayout).toBe(1);
  });

  test('homepage Gallery More starts at 60 Mempics and caps visible items at 100', async ({ page }) => {
    const items = Array.from({ length: 120 }, (_, index) => {
      const id = `progressive-mempic-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Mempics ${index + 1}`,
        caption: `Published by Ada Member on 2026-04-${String((index % 20) + 1).padStart(2, '0')}.`,
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
    const pages = {
      first: { items: items.slice(0, 24), next_cursor: 'page-2', has_more: true },
      'page-2': { items: items.slice(24, 60), next_cursor: 'page-3', has_more: true },
      'page-3': { items: items.slice(60, 100), next_cursor: 'page-4', has_more: true },
      'page-4': { items: items.slice(100), next_cursor: null, has_more: false },
    };

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor') || 'first';
      const pageData = pages[cursor] || pages.first;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: pageData.items,
            next_cursor: pageData.next_cursor,
            has_more: pageData.has_more,
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

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'gallery');

    const cards = page.locator('#galleryGrid .gallery-item:not(.locked-area)');
    await expect.poll(() => cards.count()).toBe(60);
    await waitForFixedMediaWallReady(page, '#galleryGrid', '.gallery-item:not(.locked-area)', 294);
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing 60 Mempics.');

    const showMore = page.locator('#galleryPagination .browse-pagination__toggle');
    await expect(showMore).toHaveText('Show More');
    await showMore.click();
    await expect.poll(() => cards.count()).toBe(100);
    await waitForFixedMediaWallReady(page, '#galleryGrid', '.gallery-item:not(.locked-area)', 294);
    await expect(showMore).toBeHidden();
    await expect(page.locator('#galleryPagination .browse-pagination__status')).toHaveText('Showing 100 Mempics.');

    const idsAfterClick = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.galleryItemId));
    expect(new Set(idsAfterClick).size).toBe(idsAfterClick.length);
    expect(idsAfterClick).toContain('progressive-mempic-100');
    expect(idsAfterClick).not.toContain('progressive-mempic-101');
  });

  test('homepage Video More starts at 60 Memvids and caps visible items at 100', async ({ page }) => {
    const items = Array.from({ length: 120 }, (_, index) => {
      const id = `progressive-memvid-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Launch Cut ${index + 1}`,
        caption: `Published by Ada Member on 2026-04-${String((index % 20) + 1).padStart(2, '0')}.`,
        category: 'memvids',
        file: {
          url: `/api/gallery/memvids/${id}/file`,
        },
        poster: {
          url: `/api/gallery/memvids/${id}/poster`,
          w: index % 2 === 0 ? 1280 : 720,
          h: index % 2 === 0 ? 720 : 1280,
        },
      };
    });
    const pages = {
      first: { items: items.slice(0, 24), next_cursor: 'page-2', has_more: true },
      'page-2': { items: items.slice(24, 60), next_cursor: 'page-3', has_more: true },
      'page-3': { items: items.slice(60, 100), next_cursor: 'page-4', has_more: true },
      'page-4': { items: items.slice(100), next_cursor: null, has_more: false },
    };

    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor') || 'first';
      const pageData = pages[cursor] || pages.first;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: pageData.items,
            next_cursor: pageData.next_cursor,
            has_more: pageData.has_more,
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
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
    await switchHomepageCategory(page, 'video');

    const cards = page.locator('#videoGrid .video-card');
    await expect.poll(() => cards.count()).toBe(60);
    await waitForFixedMediaWallReady(page, '#videoGrid', '.video-card', 294);
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing 60 Memvids.');

    const showMore = page.locator('#videoPagination .browse-pagination__toggle');
    await expect(showMore).toHaveText('Show More');
    await showMore.click();
    await expect.poll(() => cards.count()).toBe(100);
    await waitForFixedMediaWallReady(page, '#videoGrid', '.video-card', 294);
    await expect(showMore).toBeHidden();
    await expect(page.locator('#videoPagination .browse-pagination__status')).toHaveText('Showing 100 Memvids.');

    const idsAfterClick = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.videoItemId));
    expect(new Set(idsAfterClick).size).toBe(idsAfterClick.length);
    expect(idsAfterClick).toContain('progressive-memvid-100');
    expect(idsAfterClick).not.toContain('progressive-memvid-101');
  });

  test('homepage Sound Lab More starts at 60 Memtracks, caps at 100, and keeps playback usable', async ({ page }) => {
    const items = Array.from({ length: 120 }, (_, index) => {
      const id = `progressive-memtrack-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Public Member Track ${index + 1}`,
        caption: `Published by Ada Member on 2026-04-${String((index % 20) + 1).padStart(2, '0')}.`,
        category: 'memtracks',
        model_label: 'Music 2.6',
        publisher: {
          display_name: 'Ada Member',
        },
        file: {
          url: `/api/gallery/memtracks/${id}/file`,
        },
        poster: {
          url: `/api/gallery/memtracks/${id}/poster`,
          w: 320,
          h: 320,
        },
      };
    });
    const pages = {
      first: { items: items.slice(0, 24), next_cursor: 'page-2', has_more: true },
      'page-2': { items: items.slice(24, 60), next_cursor: 'page-3', has_more: true },
      'page-3': { items: items.slice(60, 100), next_cursor: 'page-4', has_more: true },
      'page-4': { items: items.slice(100), next_cursor: null, has_more: false },
    };

    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function playMock() {
        this.dataset.playState = 'playing';
        return Promise.resolve();
      };
    });

    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor') || 'first';
      const pageData = pages[cursor] || pages.first;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: pageData.items,
            next_cursor: pageData.next_cursor,
            has_more: pageData.has_more,
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

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'sound');

    const cards = page.locator('#soundLabTracks .snd-card--memtrack');
    await expect.poll(() => cards.count()).toBe(60);
    await waitForSoundWidthReady(page, 60);
    await expect(page.locator('.snd-memtracks-pagination .browse-pagination__status')).toHaveText('Showing 60 Memtracks.');

    const showMore = page.locator('.snd-memtracks-pagination .browse-pagination__toggle');
    await expect(showMore).toHaveText('Show More');
    await showMore.click();
    await expect.poll(() => cards.count()).toBe(100);
    await waitForSoundWidthReady(page, 100);
    await expect(showMore).toBeHidden();
    await expect(page.locator('.snd-memtracks-pagination .browse-pagination__status')).toHaveText('Showing 100 Memtracks.');

    await page.evaluate(async () => {
      localStorage.removeItem('bitbi_audio_state_v1');
      const { clearGlobalAudio } = await import('/js/shared/audio/audio-manager.js?v=__ASSET_VERSION__');
      clearGlobalAudio();
    });
    await cards.first().locator('.snd-play').evaluate((button) => button.click());
    await expect.poll(() => page.evaluate(async () => {
      try {
        const { getGlobalAudioState } = await import('/js/shared/audio/audio-manager.js?v=__ASSET_VERSION__');
        const state = getGlobalAudioState();
        const playCalls = window.__bitbiSoundMoreAudioMock?.playCalls || 0;
        return state.trackId === 'memtrack:progressive-memtrack-1'
          ? 'selected'
          : JSON.stringify({
            trackId: state.trackId || '',
            status: state.status || '',
            playIntent: !!state.playIntent,
            playCalls,
            audioConstructor: window.Audio?.name || '',
          });
      } catch {
        return 'missing';
      }
    })).toBe('selected');
    const idsAfterClick = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.memtrackId));
    expect(new Set(idsAfterClick).size).toBe(idsAfterClick.length);
    expect(idsAfterClick).toContain('progressive-memtrack-100');
    expect(idsAfterClick).not.toContain('progressive-memtrack-101');
  });

  test('homepage public media detail likes use the live interaction flow for Mempics and Memvids', async ({ page }) => {
    const likeRequests = [];
    const interactionState = {
      mempics: { liked: false, count: 0 },
      memvids: { liked: false, count: 0 },
    };

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'likes-home-user',
            email: 'likes@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/(mempics|memvids)\/([^/]+)\/interactions$/, async (route) => {
      const [, collection] = new URL(route.request().url()).pathname.match(/^\/api\/gallery\/(mempics|memvids)\//) || [];
      const state = interactionState[collection] || { liked: false, count: 0 };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            like_count: state.count,
            liked_by_viewer: state.liked,
            comment_count: 0,
            can_follow: false,
            followed_by_viewer: false,
            follower_count: 0,
            is_own_media: false,
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/(mempics|memvids)\/([^/]+)\/like$/, async (route) => {
      const url = new URL(route.request().url());
      const [, collection, mediaId] = url.pathname.match(/^\/api\/gallery\/(mempics|memvids)\/([^/]+)\/like$/) || [];
      const method = route.request().method();
      const state = interactionState[collection];
      if (state) {
        state.liked = method === 'POST';
        state.count = state.liked ? 1 : 0;
      }
      likeRequests.push({ method, collection, mediaId });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            like_count: state?.count || 0,
            liked_by_viewer: state?.liked === true,
          },
        }),
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
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/interactions') || url.pathname.endsWith('/like')) {
        await route.fallback();
        return;
      }

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

    await expect(page.locator('#galleryGrid .gallery-item .fav-star')).toHaveCount(0);
    await page.locator('#galleryGrid .gallery-item').first().click();
    const mempicLike = page.locator('#galleryModal .public-media-detail__action--like');
    await expect(mempicLike).toBeVisible();
    await mempicLike.click();
    await expect(mempicLike).toHaveAttribute('aria-pressed', 'true');
    expect(likeRequests.at(-1)).toEqual({
      method: 'POST',
      collection: 'mempics',
      mediaId: 'a1b2c3d4',
    });

    await mempicLike.click();
    await expect(mempicLike).toHaveAttribute('aria-pressed', 'false');
    expect(likeRequests.at(-1)).toEqual({
      method: 'DELETE',
      collection: 'mempics',
      mediaId: 'a1b2c3d4',
    });
    await page.locator('#galleryModal .modal-close').click();

    await switchHomepageCategory(page, 'video');

    const videoCard = page.locator('#videoGrid .video-card').first();
    await expect(videoCard.locator('.fav-star')).toHaveCount(0);

    await videoCard.click();
    const videoModalLike = page.locator('#videoModal .public-media-detail__action--like');
    await expect(videoModalLike).toBeVisible();
    await videoModalLike.click();

    expect(likeRequests.at(-1)).toEqual({
      method: 'POST',
      collection: 'memvids',
      mediaId: 'bada55e1',
    });
    await expect(videoModalLike).toHaveAttribute('aria-pressed', 'true');

    await videoModalLike.click();

    expect(likeRequests.at(-1)).toEqual({
      method: 'DELETE',
      collection: 'memvids',
      mediaId: 'bada55e1',
    });
    await expect(videoModalLike).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.video-modal-close').click();
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
    await expect(page.locator('.mobile-media-detail-overlay--video.mobile-media-detail-overlay--standalone')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video .mobile-media-detail-overlay__title')).toHaveCount(0);
    await expect(page.locator('.mobile-media-detail-overlay--video .mobile-media-detail-overlay__open-original')).toHaveCount(0);
    await expect(page.locator('.mobile-media-detail-overlay--video .mobile-media-detail-overlay__close')).toBeVisible();
    await expect(page.locator('.mobile-media-detail-overlay--video video')).toHaveAttribute('src', /\/api\/gallery\/memvids\/vid-2\/file$/);
    await expect(page.locator('#videoModal.active')).toHaveCount(0);
    await page.locator('.mobile-media-detail-overlay__close').click();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);

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

  test('mobile video modal keeps close control inside the player surface without open-original chrome', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

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
      if (route.request().url().endsWith('/interactions')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: {
              like_count: 0,
              liked_by_viewer: false,
              comment_count: 0,
              can_follow: false,
              followed_by_viewer: false,
              follower_count: 0,
              is_own_media: false,
            },
          }),
        });
        return;
      }

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

    const overlay = page.locator('.mobile-media-detail-overlay--video.mobile-media-detail-overlay--standalone');
    const closeButton = overlay.locator('.mobile-media-detail-overlay__close');
    const player = overlay.locator('video');

    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.mobile-media-detail-overlay__title')).toHaveCount(0);
    await expect(overlay.locator('.mobile-media-detail-overlay__open-original')).toHaveCount(0);
    await expect(closeButton).toBeVisible();
    await expect(player).toBeVisible();
    await expect(page.locator('#videoModal.active')).toHaveCount(0);

    const boxes = await page.evaluate(() => {
      const closeEl = document.querySelector('.mobile-media-detail-overlay--video .mobile-media-detail-overlay__close');
      const shellEl = document.querySelector('.mobile-media-detail-overlay--video .mobile-media-detail-overlay__shell');
      const playerEl = document.querySelector('.mobile-media-detail-overlay--video video');
      if (!closeEl || !shellEl || !playerEl) return null;
      const closeRect = closeEl.getBoundingClientRect();
      const shellRect = shellEl.getBoundingClientRect();
      const playerRect = playerEl.getBoundingClientRect();
      return {
        closeBottom: closeRect.bottom,
        playerTop: playerRect.top,
        closeInsideShell: closeRect.left >= shellRect.left && closeRect.right <= shellRect.right,
      };
    });

    expect(boxes).toBeTruthy();
    expect(boxes.closeBottom).toBeLessThanOrEqual(boxes.playerTop + 16);
    expect(boxes.closeInsideShell).toBe(true);

    await closeButton.click();
    await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
  });

  test('Sound Lab expands to five columns on wide desktops and steps down on smaller desktop widths', async ({ page }) => {
    const memtracks = Array.from({ length: 12 }, (_, index) => {
      const id = `sound-layout-track-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Sound Layout Track ${index + 1}`,
        caption: 'Published by Ada Member.',
        category: 'memtracks',
        model_label: 'Music 2.6',
        publisher: { display_name: 'Ada Member' },
        file: { url: `/api/gallery/memtracks/${id}/file` },
        poster: { url: `/api/gallery/memtracks/${id}/poster`, w: 640, h: 360 },
      };
    });
    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { items: memtracks, has_more: false, next_cursor: null, applied_limit: 60 },
        }),
      });
    });

    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.goto('/');
    await switchHomepageCategory(page, 'sound');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();
    await waitForSoundWidthReady(page, memtracks.length);

    const wideLayout = await page.evaluate(() => {
      const grid = document.getElementById('soundLabTracks');
      const style = window.getComputedStyle(grid);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const parseCssLength = (value, fallback) => {
        const text = String(value || '').trim();
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) return fallback;
        if (text.endsWith('rem')) return parsed * rootFontSize;
        if (text.endsWith('px')) return parsed;
        return parsed;
      };
      const cards = Array.from(grid.querySelectorAll('.snd-card')).map((node) => node.getBoundingClientRect());
      const firstTop = cards[0]?.top;
      const firstRow = Number.isFinite(firstTop)
        ? cards.filter((rect) => Math.abs(rect.top - firstTop) <= 3).sort((a, b) => a.left - b.left)
        : [];
      const horizontalGaps = firstRow.slice(1).map((rect, index) => rect.left - firstRow[index].right);
      return {
        columns: Number(grid.dataset.soundWallColumnCount) || style.gridTemplateColumns.split(' ').filter(Boolean).length,
        overflow: grid.scrollWidth - grid.clientWidth,
        averageWidth: cards.reduce((sum, rect) => sum + rect.width, 0) / Math.max(cards.length, 1),
        targetWidth: Number(grid.dataset.soundWallResolvedWidth)
          || parseCssLength(style.getPropertyValue('--bitbi-public-sound-card-resolved-width'), 363),
        baseWidth: Number(grid.dataset.soundWallBaseWidth)
          || parseCssLength(style.getPropertyValue('--bitbi-public-sound-card-width'), 363),
        targetGap: Number(grid.dataset.soundWallGap)
          || parseCssLength(style.getPropertyValue('--bitbi-public-sound-gap') || style.gap, 3),
        maxHorizontalGap: horizontalGaps.length ? Math.max(...horizontalGaps) : 0,
      };
    });

    expect(wideLayout.columns).toBeGreaterThanOrEqual(5);
    expect(wideLayout.overflow).toBeLessThanOrEqual(2);
    expect(wideLayout.baseWidth).toBeGreaterThanOrEqual(360);
    expect(wideLayout.targetWidth).toBeGreaterThanOrEqual(wideLayout.baseWidth);
    expect(Math.abs(wideLayout.averageWidth - wideLayout.targetWidth)).toBeLessThanOrEqual(2);
    expect(wideLayout.maxHorizontalGap).toBeLessThanOrEqual(wideLayout.targetGap + 3);

    await page.setViewportSize({ width: 1100, height: 1200 });
    await waitForSoundWidthReady(page, memtracks.length);
    const laptopLayout = await page.evaluate(() => {
      const grid = document.getElementById('soundLabTracks');
      return Number(grid.dataset.soundWallColumnCount) || 0;
    });

    expect(laptopLayout).toBeLessThanOrEqual(3);
  });

  test('public media walls add columns on large monitors without materially enlarging cards while hero modules scale proportionally', async ({ page }) => {
    const imagePixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
      'base64',
    );
    const dimensions = [
      { w: 360, h: 540 },
      { w: 720, h: 405 },
      { w: 440, h: 440 },
      { w: 420, h: 620 },
      { w: 640, h: 420 },
      { w: 520, h: 700 },
      { w: 560, h: 560 },
      { w: 800, h: 450 },
      { w: 380, h: 580 },
      { w: 700, h: 430 },
    ];
    const mempics = Array.from({ length: 60 }, (_, index) => {
      const size = dimensions[index % dimensions.length];
      const id = `large-wall-mempic-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Large Wall Mempic ${index + 1}`,
        created_at: `2026-05-${String((index % 25) + 1).padStart(2, '0')}T12:00:00.000Z`,
        caption: 'Published by Ada Member.',
        category: 'mempics',
        thumb: { url: `/api/gallery/mempics/${id}/thumb`, w: size.w, h: size.h },
        preview: { url: `/api/gallery/mempics/${id}/medium`, w: size.w * 2, h: size.h * 2 },
        full: { url: `/api/gallery/mempics/${id}/file` },
      };
    });
    const memvids = Array.from({ length: 60 }, (_, index) => {
      const size = dimensions[(index + 3) % dimensions.length];
      const id = `large-wall-memvid-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Large Wall Memvid ${index + 1}`,
        created_at: `2026-05-${String((index % 25) + 1).padStart(2, '0')}T12:00:00.000Z`,
        caption: 'Published by Ada Member.',
        category: 'memvids',
        file: { url: `/api/gallery/memvids/${id}/file` },
        poster: { url: `/api/gallery/memvids/${id}/poster`, w: size.w, h: size.h },
      };
    });
    const memtracks = Array.from({ length: 60 }, (_, index) => {
      const id = `large-wall-memtrack-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Large Wall Memtrack ${index + 1}`,
        caption: 'Published by Ada Member.',
        category: 'memtracks',
        model_label: 'Music 2.6',
        publisher: { display_name: 'Ada Member' },
        file: { url: `/api/gallery/memtracks/${id}/file` },
        poster: { url: `/api/gallery/memtracks/${id}/poster`, w: 640, h: 360 },
      };
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { items: mempics, has_more: false, next_cursor: null } }),
      });
    });
    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: imagePixel });
    });
    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { items: memvids, has_more: false, next_cursor: null } }),
      });
    });
    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: imagePixel });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('mock-video') });
    });
    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { items: memtracks, has_more: false, next_cursor: null, applied_limit: 60 },
        }),
      });
    });
    await page.route('**/api/gallery/memtracks/**', async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: imagePixel });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('mock-audio') });
    });

    const waitForWideColumnCount = async (gridSelector, itemSelector) => {
      await waitForFixedMediaWallReady(page, gridSelector, itemSelector, 294);
    };
    const waitForSoundWallReady = async () => {
      await waitForSoundWidthReady(page, memtracks.length);
    };

    const measureViewport = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await switchHomepageCategory(page, 'gallery');
      await expect(page.locator('#galleryGrid .gallery-item:not(.locked-area)').first()).toBeVisible();
      await waitForWideColumnCount('#galleryGrid', '.gallery-item:not(.locked-area)', '--bitbi-public-gallery-column-count');
      const gallery = await page.evaluate(() => {
        const grid = document.getElementById('galleryGrid');
        const gridRect = grid.getBoundingClientRect();
        const getStableRightEdge = () => {
          const viewportWidth = Math.min(
            window.innerWidth || Number.POSITIVE_INFINITY,
            document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
          );
          const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
          const panel = grid.closest('.home-categories__panel');
          const candidates = [
            grid.closest('#galleryExplore, #videoExplore, #soundLabExplore'),
            grid.parentElement,
            grid.closest('.section__inner'),
            panel,
            panel?.querySelector(':scope > .section__inner') || null,
          ].filter(Boolean);
          const rects = candidates
            .map((node) => {
              const nodeStyle = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return { rect, nodeStyle };
            })
            .filter(({ rect, nodeStyle }) => (
              nodeStyle.display !== 'none'
              && nodeStyle.visibility !== 'hidden'
              && rect.width > 0
              && (!finiteViewportWidth || rect.width <= finiteViewportWidth + 1)
            ))
            .map(({ rect }) => rect);
          if (!rects.length) return gridRect.right;
          return rects.reduce((narrowest, rect) => (rect.width < narrowest.width ? rect : narrowest), rects[0]).right;
        };
        const style = window.getComputedStyle(grid);
        const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        const parseCssLength = (value, fallback) => {
          const text = String(value || '').trim();
          const parsed = Number.parseFloat(text);
          if (!Number.isFinite(parsed)) return fallback;
          if (text.endsWith('rem')) return parsed * rootFontSize;
          if (text.endsWith('px')) return parsed;
          return parsed;
        };
        const rects = Array.from(document.querySelectorAll('#galleryGrid .gallery-item:not(.locked-area)'))
          .filter((node) => node.offsetParent !== null)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
          });
        const columns = [];
        rects.forEach((rect) => {
          let column = columns.find((candidate) => Math.abs(candidate - rect.left) <= 3);
          if (typeof column !== 'number') {
            columns.push(rect.left);
          }
        });
        columns.sort((a, b) => a - b);
        const columnRects = columns.map((left) => {
          const inColumn = rects.filter((rect) => Math.abs(rect.left - left) <= 3);
          return { left, right: Math.max(...inColumn.map((rect) => rect.right)) };
        });
        const horizontalGaps = columnRects.slice(1).map((column, index) => column.left - columnRects[index].right);
        return {
          renderedCount: rects.length,
          columnCount: columns.length,
          averageWidth: rects.reduce((sum, rect) => sum + rect.width, 0) / Math.max(rects.length, 1),
          gap: Number.parseFloat(style.columnGap) || 0,
          targetWidth: Number(grid.dataset.mediaWallResolvedWidth)
            || parseCssLength(style.getPropertyValue('--bitbi-public-media-wall-resolved-column-width'), 297),
          baseWidth: Number(grid.dataset.mediaWallBaseWidth)
            || parseCssLength(style.getPropertyValue('--bitbi-public-gallery-active-column-width'), 297),
          targetGap: Number(grid.dataset.mediaWallGap)
            || parseCssLength(style.getPropertyValue('--bitbi-public-media-gap') || style.columnGap, 2),
          maxHorizontalGap: horizontalGaps.length ? Math.max(...horizontalGaps) : 0,
          rightUnused: getStableRightEdge() - Math.max(...rects.map((rect) => rect.right)),
        };
      });

      await switchHomepageCategory(page, 'video');
      await expect(page.locator('#videoGrid .video-card').first()).toBeVisible();
      await waitForWideColumnCount('#videoGrid', '.video-card', '--bitbi-public-video-column-count');
      const video = await page.evaluate(() => {
        const grid = document.getElementById('videoGrid');
        const gridRect = grid.getBoundingClientRect();
        const getStableRightEdge = () => {
          const viewportWidth = Math.min(
            window.innerWidth || Number.POSITIVE_INFINITY,
            document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
          );
          const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
          const panel = grid.closest('.home-categories__panel');
          const candidates = [
            grid.closest('#galleryExplore, #videoExplore, #soundLabExplore'),
            grid.parentElement,
            grid.closest('.section__inner'),
            panel,
            panel?.querySelector(':scope > .section__inner') || null,
          ].filter(Boolean);
          const rects = candidates
            .map((node) => {
              const nodeStyle = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return { rect, nodeStyle };
            })
            .filter(({ rect, nodeStyle }) => (
              nodeStyle.display !== 'none'
              && nodeStyle.visibility !== 'hidden'
              && rect.width > 0
              && (!finiteViewportWidth || rect.width <= finiteViewportWidth + 1)
            ))
            .map(({ rect }) => rect);
          if (!rects.length) return gridRect.right;
          return rects.reduce((narrowest, rect) => (rect.width < narrowest.width ? rect : narrowest), rects[0]).right;
        };
        const style = window.getComputedStyle(grid);
        const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        const parseCssLength = (value, fallback) => {
          const text = String(value || '').trim();
          const parsed = Number.parseFloat(text);
          if (!Number.isFinite(parsed)) return fallback;
          if (text.endsWith('rem')) return parsed * rootFontSize;
          if (text.endsWith('px')) return parsed;
          return parsed;
        };
        const rects = Array.from(document.querySelectorAll('#videoGrid .video-card'))
          .filter((node) => node.offsetParent !== null)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
          });
        const columns = [];
        rects.forEach((rect) => {
          let column = columns.find((candidate) => Math.abs(candidate - rect.left) <= 3);
          if (typeof column !== 'number') {
            columns.push(rect.left);
          }
        });
        columns.sort((a, b) => a - b);
        const columnRects = columns.map((left) => {
          const inColumn = rects.filter((rect) => Math.abs(rect.left - left) <= 3);
          return { left, right: Math.max(...inColumn.map((rect) => rect.right)) };
        });
        const horizontalGaps = columnRects.slice(1).map((column, index) => column.left - columnRects[index].right);
        return {
          renderedCount: rects.length,
          columnCount: columns.length,
          averageWidth: rects.reduce((sum, rect) => sum + rect.width, 0) / Math.max(rects.length, 1),
          gap: Number.parseFloat(style.columnGap) || 0,
          targetWidth: Number(grid.dataset.mediaWallResolvedWidth)
            || parseCssLength(style.getPropertyValue('--bitbi-public-media-wall-resolved-column-width'), 297),
          baseWidth: Number(grid.dataset.mediaWallBaseWidth)
            || parseCssLength(style.getPropertyValue('--bitbi-public-video-active-column-width'), 297),
          targetGap: Number(grid.dataset.mediaWallGap)
            || parseCssLength(style.getPropertyValue('--bitbi-public-media-gap') || style.columnGap, 2),
          maxHorizontalGap: horizontalGaps.length ? Math.max(...horizontalGaps) : 0,
          rightUnused: getStableRightEdge() - Math.max(...rects.map((rect) => rect.right)),
        };
      });

      await switchHomepageCategory(page, 'sound');
      await expect(page.locator('#soundLabTracks .snd-card--memtrack').first()).toBeVisible();
      await waitForSoundWallReady();
      const rest = await page.evaluate(() => {
        const summarizeRows = (selector) => {
          const grid = document.getElementById('soundLabTracks');
          const gridRect = grid.getBoundingClientRect();
          const getStableRightEdge = () => {
            const viewportWidth = Math.min(
              window.innerWidth || Number.POSITIVE_INFINITY,
              document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
            );
            const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
            const panel = grid.closest('.home-categories__panel');
            const candidates = [
              grid.closest('#galleryExplore, #videoExplore, #soundLabExplore'),
              grid.parentElement,
              grid.closest('.section__inner'),
              panel,
              panel?.querySelector(':scope > .section__inner') || null,
            ].filter(Boolean);
            const stableRects = candidates
              .map((node) => {
                const nodeStyle = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return { rect, nodeStyle };
              })
              .filter(({ rect, nodeStyle }) => (
                nodeStyle.display !== 'none'
                && nodeStyle.visibility !== 'hidden'
                && rect.width > 0
                && (!finiteViewportWidth || rect.width <= finiteViewportWidth + 1)
              ))
              .map(({ rect }) => rect);
            if (!stableRects.length) return gridRect.right;
            return stableRects.reduce((narrowest, rect) => (rect.width < narrowest.width ? rect : narrowest), stableRects[0]).right;
          };
          const style = window.getComputedStyle(grid);
          const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
          const parseCssLength = (value, fallback) => {
            const text = String(value || '').trim();
            const parsed = Number.parseFloat(text);
            if (!Number.isFinite(parsed)) return fallback;
            if (text.endsWith('rem')) return parsed * rootFontSize;
            if (text.endsWith('px')) return parsed;
            return parsed;
          };
          const rects = Array.from(document.querySelectorAll(selector))
            .filter((node) => node.offsetParent !== null)
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return { left: rect.left, top: rect.top, width: rect.width };
            });
          const rows = [];
          rects.forEach((rect) => {
            let row = rows.find((candidate) => Math.abs(candidate.top - rect.top) <= 3);
            if (!row) {
              row = { top: rect.top, rects: [] };
              rows.push(row);
            }
            row.rects.push(rect);
          });
          rows.sort((a, b) => a.top - b.top);
          const firstRowRects = [...(rows[0]?.rects || [])].sort((a, b) => a.left - b.left);
          const horizontalGaps = firstRowRects.slice(1).map((rect, index) => (
            rect.left - (firstRowRects[index].left + firstRowRects[index].width)
          ));
          return {
            renderedCount: rects.length,
            firstRowCount: rows[0]?.rects.length || 0,
            averageWidth: rects.reduce((sum, rect) => sum + rect.width, 0) / Math.max(rects.length, 1),
            gap: Number.parseFloat(style.columnGap || style.gap) || 0,
            targetWidth: Number(grid.dataset.soundWallResolvedWidth)
              || parseCssLength(style.getPropertyValue('--bitbi-public-sound-card-resolved-width'), 363),
            baseWidth: Number(grid.dataset.soundWallBaseWidth)
              || parseCssLength(style.getPropertyValue('--bitbi-public-sound-card-width'), 363),
            targetGap: Number(grid.dataset.soundWallGap)
              || parseCssLength(style.getPropertyValue('--bitbi-public-sound-gap') || style.gap, 3),
            maxHorizontalGap: horizontalGaps.length ? Math.max(...horizontalGaps) : 0,
            rightUnused: getStableRightEdge() - Math.max(...rects.map((rect) => rect.left + rect.width)),
          };
        };
        const heroModule = Array.from(document.querySelectorAll('.hero__models-cta'))
          .map((node) => node.getBoundingClientRect())
          .find((rect) => rect.width > 0 && rect.height > 0);
        return {
          sound: summarizeRows('#soundLabTracks .snd-card--memtrack'),
          heroModuleWidth: heroModule?.width || 0,
          heroScaleActive: document.querySelector('#hero')?.dataset.homepageHeroLargeScale === 'true',
          overflowX: Math.max(
            0,
            document.documentElement.scrollWidth - window.innerWidth,
            document.body.scrollWidth - window.innerWidth,
          ),
        };
      });
      return { gallery, video, ...rest };
    };

    const normal = await measureViewport(1440, 900);
    const large = await measureViewport(2560, 1440);

    expect(large.gallery.columnCount).toBeGreaterThan(normal.gallery.columnCount);
    expect(normal.gallery.renderedCount).toBe(60);
    expect(large.gallery.renderedCount).toBe(60);
    expect(large.gallery.averageWidth).toBeLessThanOrEqual(normal.gallery.averageWidth * 1.15);
    expect(large.gallery.averageWidth).toBeGreaterThanOrEqual(normal.gallery.averageWidth * 0.78);
    expect(large.gallery.baseWidth).toBeGreaterThanOrEqual(294);
    expect(large.gallery.targetWidth).toBeGreaterThanOrEqual(large.gallery.baseWidth);
    expect(Math.abs(large.gallery.averageWidth - large.gallery.targetWidth)).toBeLessThanOrEqual(2);
    expect(large.gallery.maxHorizontalGap).toBeLessThanOrEqual(large.gallery.targetGap + 3);
    expect(large.gallery.rightUnused).toBeLessThanOrEqual(Math.max(3, large.gallery.targetGap + 1));
    expect(large.video.columnCount).toBeGreaterThan(normal.video.columnCount);
    expect(normal.video.renderedCount).toBe(60);
    expect(large.video.renderedCount).toBe(60);
    expect(large.video.averageWidth).toBeLessThanOrEqual(normal.video.averageWidth * 1.15);
    expect(large.video.averageWidth).toBeGreaterThanOrEqual(normal.video.averageWidth * 0.78);
    expect(large.video.baseWidth).toBeGreaterThanOrEqual(294);
    expect(large.video.targetWidth).toBeGreaterThanOrEqual(large.video.baseWidth);
    expect(Math.abs(large.video.averageWidth - large.video.targetWidth)).toBeLessThanOrEqual(2);
    expect(large.video.maxHorizontalGap).toBeLessThanOrEqual(large.video.targetGap + 3);
    expect(large.video.rightUnused).toBeLessThanOrEqual(Math.max(3, large.video.targetGap + 1));
    expect(large.sound.firstRowCount).toBeGreaterThan(normal.sound.firstRowCount);
    expect(large.sound.averageWidth).toBeLessThanOrEqual(normal.sound.averageWidth * 1.15);
    expect(large.sound.averageWidth).toBeGreaterThanOrEqual(normal.sound.averageWidth * 0.88);
    expect(large.sound.baseWidth).toBeGreaterThanOrEqual(360);
    expect(large.sound.targetWidth).toBeGreaterThanOrEqual(large.sound.baseWidth);
    expect(Math.abs(large.sound.averageWidth - large.sound.targetWidth)).toBeLessThanOrEqual(2);
    expect(large.sound.maxHorizontalGap).toBeLessThanOrEqual(large.sound.targetGap + 3);
    expect(large.sound.rightUnused).toBeLessThanOrEqual(Math.max(3, large.sound.targetGap + 1));
    expect(large.heroModuleWidth).toBeGreaterThan(0);
    expect(large.heroScaleActive).toBe(true);
    expect(large.heroModuleWidth).toBeGreaterThanOrEqual(normal.heroModuleWidth * 1.2);
    expect(large.heroModuleWidth).toBeLessThanOrEqual(normal.heroModuleWidth * 1.75);
    expect(large.overflowX).toBeLessThanOrEqual(2);
  });

  test('public media walls spread finite live item sets across large monitors', async ({ page }) => {
    const imagePixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
      'base64',
    );
    const dimensions = [
      { w: 360, h: 540 },
      { w: 720, h: 405 },
      { w: 440, h: 440 },
      { w: 420, h: 620 },
      { w: 640, h: 420 },
      { w: 520, h: 700 },
      { w: 560, h: 560 },
      { w: 800, h: 450 },
      { w: 380, h: 580 },
      { w: 700, h: 430 },
    ];
    const mempics = Array.from({ length: 20 }, (_, index) => {
      const size = dimensions[index % dimensions.length];
      const id = `finite-wall-mempic-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Finite Wall Mempic ${index + 1}`,
        created_at: `2026-05-${String((index % 20) + 1).padStart(2, '0')}T12:00:00.000Z`,
        caption: 'Published by Ada Member.',
        category: 'mempics',
        thumb: { url: `/api/gallery/mempics/${id}/thumb`, w: size.w, h: size.h },
        preview: { url: `/api/gallery/mempics/${id}/medium`, w: size.w * 2, h: size.h * 2 },
        full: { url: `/api/gallery/mempics/${id}/file` },
      };
    });
    const memvids = Array.from({ length: 20 }, (_, index) => {
      const size = dimensions[(index + 3) % dimensions.length];
      const id = `finite-wall-memvid-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Finite Wall Memvid ${index + 1}`,
        created_at: `2026-05-${String((index % 20) + 1).padStart(2, '0')}T12:00:00.000Z`,
        caption: 'Published by Ada Member.',
        category: 'memvids',
        file: { url: `/api/gallery/memvids/${id}/file` },
        poster: { url: `/api/gallery/memvids/${id}/poster`, w: size.w, h: size.h },
      };
    });
    const memtracks = Array.from({ length: 20 }, (_, index) => {
      const id = `finite-wall-memtrack-${index + 1}`;
      return {
        id,
        slug: id,
        title: `Finite Wall Memtrack ${index + 1}`,
        caption: 'Published by Ada Member.',
        category: 'memtracks',
        model_label: 'Music 2.6',
        publisher: { display_name: 'Ada Member' },
        file: { url: `/api/gallery/memtracks/${id}/file` },
        poster: { url: `/api/gallery/memtracks/${id}/poster`, w: 640, h: 360 },
      };
    });

    await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { items: mempics, has_more: false, next_cursor: null } }),
      });
    });
    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: imagePixel });
    });
    await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { items: memvids, has_more: false, next_cursor: null } }),
      });
    });
    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: imagePixel });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('mock-video') });
    });
    await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { items: memtracks, has_more: false, next_cursor: null, applied_limit: 20 },
        }),
      });
    });
    await page.route('**/api/gallery/memtracks/**', async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: imagePixel });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('mock-audio') });
    });

    const waitForWideWallReady = async (gridSelector, itemSelector) => {
      await waitForFixedMediaWallReady(page, gridSelector, itemSelector, 294);
    };

    const readWall = async (gridSelector, itemSelector) => page.evaluate(({ gridSelector: selector, itemSelector: childSelector }) => {
      const grid = document.querySelector(selector);
      const gridRect = grid.getBoundingClientRect();
      const getStableRightEdge = () => {
        const viewportWidth = Math.min(
          window.innerWidth || Number.POSITIVE_INFINITY,
          document.documentElement?.clientWidth || Number.POSITIVE_INFINITY,
        );
        const finiteViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;
        const panel = grid.closest('.home-categories__panel');
        const candidates = [
          grid.closest('#galleryExplore, #videoExplore, #soundLabExplore'),
          grid.parentElement,
          grid.closest('.section__inner'),
          panel,
          panel?.querySelector(':scope > .section__inner') || null,
        ].filter(Boolean);
        const stableRects = candidates
          .map((node) => {
            const nodeStyle = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return { rect, nodeStyle };
          })
          .filter(({ rect, nodeStyle }) => (
            nodeStyle.display !== 'none'
            && nodeStyle.visibility !== 'hidden'
            && rect.width > 0
            && (!finiteViewportWidth || rect.width <= finiteViewportWidth + 1)
          ))
          .map(({ rect }) => rect);
        if (!stableRects.length) return gridRect.right;
        return stableRects.reduce((narrowest, rect) => (rect.width < narrowest.width ? rect : narrowest), stableRects[0]).right;
      };
      const style = window.getComputedStyle(grid);
      const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const parseCssLength = (value, fallback) => {
        const text = String(value || '').trim();
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) return fallback;
        if (text.endsWith('rem')) return parsed * rootFontSize;
        if (text.endsWith('px')) return parsed;
        return parsed;
      };
      const rects = Array.from(grid.querySelectorAll(childSelector))
        .filter((node) => node.offsetParent !== null)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, width: rect.width };
        });
      const columns = [];
      rects.forEach((rect) => {
        if (!columns.some((left) => Math.abs(left - rect.left) <= 3)) columns.push(rect.left);
      });
      columns.sort((a, b) => a - b);
      const columnRects = columns.map((left) => {
        const inColumn = rects.filter((rect) => Math.abs(rect.left - left) <= 3);
        return { left, right: Math.max(...inColumn.map((rect) => rect.right)) };
      });
      const horizontalGaps = columnRects.slice(1).map((column, index) => column.left - columnRects[index].right);
      const targetWidthProperty = selector === '#soundLabTracks'
        ? '--bitbi-public-sound-card-width'
        : selector === '#videoGrid'
          ? '--bitbi-public-video-active-column-width'
          : '--bitbi-public-gallery-active-column-width';
      const targetGapProperty = selector === '#soundLabTracks'
        ? '--bitbi-public-sound-gap'
        : '--bitbi-public-media-gap';
      return {
        renderedCount: rects.length,
        columnCount: columns.length,
        averageWidth: rects.reduce((sum, rect) => sum + rect.width, 0) / Math.max(rects.length, 1),
        gap: Number.parseFloat(style.columnGap || style.gap) || 0,
        targetWidth: selector === '#soundLabTracks'
          ? Number(grid.dataset.soundWallResolvedWidth)
            || parseCssLength(style.getPropertyValue('--bitbi-public-sound-card-resolved-width'), 363)
          : Number(grid.dataset.mediaWallResolvedWidth)
            || parseCssLength(style.getPropertyValue('--bitbi-public-media-wall-resolved-column-width'), 297),
        baseWidth: selector === '#soundLabTracks'
          ? Number(grid.dataset.soundWallBaseWidth)
            || parseCssLength(style.getPropertyValue(targetWidthProperty), 363)
          : Number(grid.dataset.mediaWallBaseWidth)
            || parseCssLength(style.getPropertyValue(targetWidthProperty), 297),
        targetGap: selector === '#soundLabTracks'
          ? Number(grid.dataset.soundWallGap)
            || parseCssLength(style.getPropertyValue(targetGapProperty) || style.columnGap || style.gap, 3)
          : Number(grid.dataset.mediaWallGap)
            || parseCssLength(style.getPropertyValue(targetGapProperty) || style.columnGap || style.gap, 2),
        maxHorizontalGap: horizontalGaps.length ? Math.max(...horizontalGaps) : 0,
        rightUnused: getStableRightEdge() - Math.max(...rects.map((rect) => rect.right)),
      };
    }, { gridSelector, itemSelector });

    const measureViewport = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await switchHomepageCategory(page, 'gallery');
      await waitForWideWallReady('#galleryGrid', '.gallery-item:not(.locked-area)', '--bitbi-public-gallery-column-count');
      const gallery = await readWall('#galleryGrid', '.gallery-item:not(.locked-area)');

      await switchHomepageCategory(page, 'video');
      await waitForWideWallReady('#videoGrid', '.video-card', '--bitbi-public-video-column-count');
      const video = await readWall('#videoGrid', '.video-card');

      await switchHomepageCategory(page, 'sound');
      await expect(page.locator('#soundLabTracks .snd-card--memtrack').first()).toBeVisible();
      await expect.poll(async () => page.locator('#soundLabTracks .snd-card--memtrack:visible').count()).toBe(20);
      await waitForSoundWidthReady(page, 20);
      const sound = await readWall('#soundLabTracks', '.snd-card--memtrack');

      return { gallery, video, sound };
    };

    const normal = await measureViewport(1440, 900);
    const large = await measureViewport(2560, 1440);

    expect(large.gallery.columnCount).toBeGreaterThan(normal.gallery.columnCount);
    expect(large.gallery.renderedCount).toBeGreaterThanOrEqual(normal.gallery.renderedCount);
    expect(large.gallery.averageWidth).toBeLessThanOrEqual(normal.gallery.averageWidth * 1.15);
    expect(large.gallery.baseWidth).toBeGreaterThanOrEqual(294);
    expect(large.gallery.targetWidth).toBeGreaterThanOrEqual(large.gallery.baseWidth);
    expect(Math.abs(large.gallery.averageWidth - large.gallery.targetWidth)).toBeLessThanOrEqual(2);
    expect(large.gallery.maxHorizontalGap).toBeLessThanOrEqual(large.gallery.targetGap + 3);
    expect(large.gallery.rightUnused).toBeLessThanOrEqual(Math.max(3, large.gallery.targetGap + 1));
    expect(large.video.columnCount).toBeGreaterThan(normal.video.columnCount);
    expect(large.video.renderedCount).toBeGreaterThanOrEqual(normal.video.renderedCount);
    expect(large.video.averageWidth).toBeLessThanOrEqual(normal.video.averageWidth * 1.15);
    expect(large.video.baseWidth).toBeGreaterThanOrEqual(294);
    expect(large.video.targetWidth).toBeGreaterThanOrEqual(large.video.baseWidth);
    expect(Math.abs(large.video.averageWidth - large.video.targetWidth)).toBeLessThanOrEqual(2);
    expect(large.video.maxHorizontalGap).toBeLessThanOrEqual(large.video.targetGap + 3);
    expect(large.video.rightUnused).toBeLessThanOrEqual(Math.max(3, large.video.targetGap + 1));
    expect(large.sound.columnCount).toBeGreaterThan(normal.sound.columnCount);
    expect(large.sound.averageWidth).toBeLessThanOrEqual(normal.sound.averageWidth * 1.15);
    expect(large.sound.baseWidth).toBeGreaterThanOrEqual(360);
    expect(large.sound.targetWidth).toBeGreaterThanOrEqual(large.sound.baseWidth);
    expect(Math.abs(large.sound.averageWidth - large.sound.targetWidth)).toBeLessThanOrEqual(2);
    expect(large.sound.maxHorizontalGap).toBeLessThanOrEqual(large.sound.targetGap + 3);
  });

  test('homepage Sound Lab renders published member tracks directly without Free or Exclusive categories', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
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
    await expect(memtrackCard.locator('.fav-star')).toHaveCount(0);
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

test.describe('Global Help Menu', () => {
  test('appears on Admin with English-only organization guidance', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, user: null }),
      });
    });
    await page.route('**/api/admin/me', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Admin required', code: 'ADMIN_REQUIRED' }),
      });
    });

    await page.goto('/admin/');
    const trigger = page.getByRole('button', { name: 'Open help menu' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.locator('#bitbiHelpPanel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.help-menu__section-title').first()).toHaveText('Admin & organizations');
    const adminSection = panel.locator('[data-help-section="admin"]');
    await expect(adminSection.locator('.help-menu__items')).toBeHidden();
    await adminSection.locator('.help-menu__section-toggle').click();
    await expect(adminSection).toHaveAttribute('open', '');
    await expect(adminSection).toContainText('Organization membership controls context without bypassing safety guards');
    await expect(panel.locator('a[href^="/de/admin"]')).toHaveCount(0);
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
  test('shared subpage desktop header keeps public navigation links beside the brand without the mood pill', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/legal/imprint.html');

    const nav = page.locator('.site-nav__links');
    const videoLink = nav.getByRole('link', { name: 'Video' });
    await expect(videoLink).toBeVisible();
    await expect(videoLink).toHaveAttribute('href', /\/#video-creations$/);
    await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab']);
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
        gallery: rect('#navbar [data-category-link="gallery"]'),
        video: rect('#navbar [data-category-link="video"]'),
        actions: rect('#navbar .site-nav__actions'),
        moodDisplay: mood ? window.getComputedStyle(mood).display : null,
        moodWidth: mood ? mood.getBoundingClientRect().width : null,
      };
    });

    expect(metrics.video).toBeTruthy();
    expect(metrics.gallery.left).toBeGreaterThan(metrics.logo.right + 8);
    expect(metrics.video.left).toBeGreaterThan(metrics.gallery.right);
    expectWithinPx(metrics.viewportWidth - metrics.actions.right, metrics.logo.left, 'shared subpage right actions inset', 4);
    expect(metrics.moodDisplay).toBe('none');
    expect(metrics.moodWidth).toBe(0);
    await expect(page.locator('a[aria-label="YouTube"]')).toHaveCount(0);
  });

  test('profile page uses the full shared header navigation instead of the logo-only fallback', async ({ page }) => {
    await page.goto('/account/profile.html');

    const nav = page.locator('.site-nav__links');
    await expect(nav.getByRole('link', { name: 'Video' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect
      .poll(() => nav.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim())))
      .toEqual(['Gallery', 'Video', 'Sound Lab']);
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
          .toEqual(['Gallery', 'Video', 'Sound Lab']);
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
      .toEqual(['Gallery', 'Video', 'Sound Lab', 'Models']);
    await expect(mobileConnect.getByRole('link', { name: 'Contact' })).toBeVisible();
  });

  for (const pathname of MODELS_OVERLAY_PATHS) {
    test(`${pathname} opens the local MODELS overlay from the mobile menu without navigation`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(pathname);
      const currentUrl = new URL(page.url());
      const currentPath = `${currentUrl.pathname}${currentUrl.hash}`;

      await page.locator('#mobileMenuBtn').click();
      const modelsButton = page.locator('#mobileNav [data-models-link="mobile"]');
      await modelsButton.click();

      await expectPathUnchanged(page, currentPath);
      await expectModelsOverlayOpenState(page);

      await page.locator('.models-overlay__close').click();
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
