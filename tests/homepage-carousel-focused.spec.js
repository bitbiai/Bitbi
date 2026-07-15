const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TEST_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  'base64',
);
const TEST_MP4_BYTES = fs.readFileSync(path.join(__dirname, 'fixtures/media/test-video.mp4'));
const CAROUSEL_CSS = fs.readFileSync(path.join(__dirname, '..', 'css/pages/index.css'), 'utf8');
const CAROUSEL_JS = fs.readFileSync(path.join(__dirname, '..', 'js/pages/index/category-carousel.js'), 'utf8');
const WALLS = {
  gallery: '#galleryGrid',
  video: '#videoGrid',
  sound: '#soundLabTracks',
};

async function installCarouselWorkInstrumentation(page) {
  await page.addInitScript(() => {
    window.__carouselTestWork = {
      cls: 0,
      innerHtmlWrites: { gallery: 0, video: 0, sound: 0 },
      replaceChildren: { gallery: 0, video: 0, sound: 0 },
      cardRectReads: { gallery: 0, video: 0, sound: 0 },
      longTaskSupported: false,
      longTasks: [],
    };
    const categoryForNode = (node) => {
      if (node?.id === 'galleryGrid' || node?.matches?.('.gallery-item')) return 'gallery';
      if (node?.id === 'videoGrid' || node?.matches?.('.video-card')) return 'video';
      if (node?.id === 'soundLabTracks' || node?.matches?.('.snd-card--memtrack')) return 'sound';
      return '';
    };

    const originalReplaceChildren = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function instrumentedReplaceChildren(...nodes) {
      const category = categoryForNode(this);
      if (category) window.__carouselTestWork.replaceChildren[category] += 1;
      return originalReplaceChildren.apply(this, nodes);
    };

    const innerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (innerHtml?.configurable && innerHtml.get && innerHtml.set) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: true,
        enumerable: innerHtml.enumerable,
        get() {
          return innerHtml.get.call(this);
        },
        set(value) {
          const category = categoryForNode(this);
          if (category) window.__carouselTestWork.innerHtmlWrites[category] += 1;
          innerHtml.set.call(this, value);
        },
      });
    }

    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function instrumentedRect() {
      const category = categoryForNode(this);
      if (category && this.id === '') window.__carouselTestWork.cardRectReads[category] += 1;
      return originalRect.call(this);
    };

    if (typeof PerformanceObserver === 'function') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__carouselTestWork.cls += entry.value;
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
      } catch {}
      try {
        if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
          window.__carouselTestWork.longTaskSupported = true;
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__carouselTestWork.longTasks.push({
                startTime: entry.startTime,
                duration: entry.duration,
              });
            }
            if (window.__carouselTestWork.longTasks.length > 200) {
              window.__carouselTestWork.longTasks.splice(0, window.__carouselTestWork.longTasks.length - 200);
            }
          });
          observer.observe({ type: 'longtask', buffered: true });
        }
      } catch {}
    }
    HTMLMediaElement.prototype.play = function playMock() {
      this.dataset.playState = 'playing';
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pauseMock() {
      this.dataset.playState = 'paused';
    };
    const nativeMediaAddEventListener = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function addEventListenerMock(type, listener, options) {
      if (type === 'error') return undefined;
      return nativeMediaAddEventListener.call(this, type, listener, options);
    };
  });
}

function buildMempics() {
  return Array.from({ length: 6 }, (_, index) => {
    const id = `carousel-mempic-${index + 1}`;
    return {
      id,
      slug: id,
      title: `Carousel Mempic ${index + 1}`,
      caption: 'Populated carousel gallery fixture.',
      category: 'mempics',
      thumb: { url: `/api/gallery/mempics/${id}/thumb`, w: 640, h: 640 },
      preview: { url: `/api/gallery/mempics/${id}/medium`, w: 1280, h: 1280 },
      full: { url: `/api/gallery/mempics/${id}/file` },
    };
  });
}

function buildMemvids() {
  return Array.from({ length: 6 }, (_, index) => {
    const id = `carousel-memvid-${index + 1}`;
    return {
      id,
      slug: id,
      title: `Carousel Memvid ${index + 1}`,
      caption: 'Populated carousel video fixture.',
      category: 'memvids',
      publisher: { display_name: 'Fixture Publisher' },
      file: { url: `/api/gallery/memvids/${id}/file` },
      poster: { url: `/api/gallery/memvids/${id}/poster`, w: 1280, h: 720 },
      stream_preview: {
        provider: 'cloudflare_stream',
        uid: `carouselStreamUid${index + 1}`,
        autoplay_enabled: true,
        preview_duration_seconds: 5,
        max_loop_count: 3,
        playback: {
          mp4_url: `https://videodelivery.net/carouselStreamUid${index + 1}/downloads/default.mp4`,
          hls_url: `https://videodelivery.net/carouselStreamUid${index + 1}/manifest/video.m3u8`,
        },
      },
    };
  });
}

function buildMemtracks() {
  return Array.from({ length: 12 }, (_, index) => {
    const id = `carousel-memtrack-${index + 1}`;
    return {
      id,
      slug: id,
      title: `Carousel Memtrack ${index + 1}`,
      caption: 'Populated carousel sound fixture.',
      category: 'memtracks',
      model_label: 'Music 2.6',
      publisher: { display_name: 'Fixture Publisher' },
      file: { url: `/api/gallery/memtracks/${id}/file` },
      poster: { url: `/api/gallery/memtracks/${id}/poster`, w: 640, h: 360 },
    };
  });
}

async function routePopulatedHomepage(page) {
  const mempics = buildMempics();
  const memvids = buildMemvids();
  const memtracks = buildMemtracks();

  await page.route('**/api/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ loggedIn: false, user: null }),
  }));
  await page.route('**/api/public/news-pulse**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], updated_at: '2026-07-15T00:00:00.000Z' }),
  }));
  await page.route(/\/api\/gallery\/mempics(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { items: mempics, has_more: false, next_cursor: null } }),
  }));
  await page.route(/\/api\/gallery\/memvids(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { items: memvids, has_more: false, next_cursor: null } }),
  }));
  await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data: { items: memtracks, has_more: false, next_cursor: null, applied_limit: 60 },
    }),
  }));
  await page.route(/\/api\/gallery\/mempics\/[^/]+\/(?:thumb|medium|file)(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TEST_PNG_BYTES,
  }));
  await page.route(/\/api\/gallery\/memvids\/[^/]+\/(?:poster|avatar)(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TEST_PNG_BYTES,
  }));
  await page.route(/\/api\/gallery\/memvids\/[^/]+\/(?:file|stream-preview\/hover-start)(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    body: TEST_MP4_BYTES,
  }));
  await page.route('https://videodelivery.net/**', (route) => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    body: TEST_MP4_BYTES,
  }));
  await page.route(/\/api\/gallery\/memtracks\/[^/]+\/poster(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: TEST_PNG_BYTES,
  }));
  await page.route(/\/api\/gallery\/memtracks\/[^/]+\/file(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'audio/mpeg',
    body: Buffer.from('fixture-audio'),
  }));
}

async function waitForPopulatedHomepage(page, pathName = '/') {
  await page.goto(pathName);
  await expect(page.locator('#galleryGrid .gallery-item')).toHaveCount(6);
  await expect(page.locator('#videoGrid .video-card')).toHaveCount(6);
  await expect(page.locator('#soundLabTracks .snd-card--memtrack')).toHaveCount(12);
}

async function readStageState(page) {
  return page.locator('#homeCategories').evaluate((stage) => ({
    active: stage.dataset.activeCategory || '',
    mode: stage.dataset.stageMode || '',
    engine: stage.dataset.motionEngine || '',
    transitioning: stage.classList.contains('is-transitioning'),
    viewportHeight: stage.querySelector('.home-categories__viewport')?.style.height || '',
    transientPanelCount: stage.querySelectorAll(
      '.is-transition-current,.is-transition-next,.is-enter-active,.is-leave-left,.is-leave-right,.is-layout-preparing',
    ).length,
  }));
}

async function waitForSettledCategory(page, category) {
  await expect.poll(() => readStageState(page), { timeout: 12_000 }).toMatchObject({
    active: category,
    transitioning: false,
    viewportHeight: '',
    transientPanelCount: 0,
  });
}

async function expectSingleInteractivePanel(page, activeCategory) {
  const panels = await page.locator('#homeCategories').evaluate((stage) => (
    Array.from(stage.querySelectorAll('[data-category-panel]')).map((panel) => ({
      category: panel.dataset.categoryPanel,
      ariaHidden: panel.getAttribute('aria-hidden'),
      inert: panel.hasAttribute('inert'),
      pointerEvents: getComputedStyle(panel).pointerEvents,
    }))
  ));
  for (const panel of panels) {
    const active = panel.category === activeCategory;
    expect(panel.ariaHidden).toBe(active ? 'false' : 'true');
    expect(panel.inert).toBe(!active);
    expect(panel.pointerEvents).toBe(active ? 'auto' : 'none');
  }
}

async function selectCategory(page, category) {
  await page.locator(`#navbar .site-nav__links [data-category-link="${category}"]`).click();
  await waitForSettledCategory(page, category);
}

async function waitForSoundLayout(page) {
  await expect.poll(async () => page.locator('#soundLabTracks').evaluate((grid) => ({
    ready: grid.dataset.soundWallReady || grid.dataset.soundWidthReady || '',
  })), { timeout: 12_000 }).toEqual(expect.objectContaining({
    ready: 'true',
  }));
}

async function waitForPublicWall(page, category) {
  const selector = WALLS[category];
  await expect.poll(() => page.locator(selector).evaluate((grid) => (
    grid.dataset.mediaWallReady || grid.dataset.publicMediaWallReady || ''
  )), { timeout: 12_000 }).toBe('true');
}

async function readSoundLayout(page) {
  return page.locator('#soundLabTracks').evaluate((grid) => ({
    metrics: [
      grid.dataset.soundWallAvailableWidth || '',
      grid.dataset.soundWallBaseWidth || '',
      grid.dataset.soundWallResolvedWidth || '',
      grid.dataset.soundWallGap || '',
      grid.dataset.soundWallColumnCount || '',
      grid.dataset.soundWallCapacity || '',
      grid.style.gridTemplateColumns,
    ],
    widths: Array.from(grid.querySelectorAll('.snd-card--memtrack')).map((card) => ({
      width: card.style.width,
      minWidth: card.style.minWidth,
      maxWidth: card.style.maxWidth,
    })),
  }));
}

async function startWarmDomTracking(page) {
  await page.evaluate(() => {
    window.__carouselWarmNodes = {
      gallery: Array.from(document.querySelectorAll('#galleryGrid .gallery-item')),
      video: Array.from(document.querySelectorAll('#videoGrid .video-card')),
      sound: Array.from(document.querySelectorAll('#soundLabTracks .snd-card--memtrack')),
    };
    window.__carouselDomWork = {
      childMutations: { gallery: 0, video: 0, sound: 0 },
      styleMutations: { gallery: 0, video: 0, sound: 0 },
    };
    window.__carouselDomObservers = [];
    Object.entries({ gallery: '#galleryGrid', video: '#videoGrid', sound: '#soundLabTracks' })
      .forEach(([category, selector]) => {
        const grid = document.querySelector(selector);
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === 'childList') window.__carouselDomWork.childMutations[category] += 1;
            if (record.type === 'attributes') window.__carouselDomWork.styleMutations[category] += 1;
          }
        });
        observer.observe(grid, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
        window.__carouselDomObservers.push(observer);
      });
  });
}

async function readWarmWork(page) {
  return page.evaluate(() => {
    const selectors = { gallery: '#galleryGrid .gallery-item', video: '#videoGrid .video-card', sound: '#soundLabTracks .snd-card--memtrack' };
    const identity = Object.fromEntries(Object.entries(selectors).map(([category, selector]) => {
      const current = Array.from(document.querySelectorAll(selector));
      const warm = window.__carouselWarmNodes?.[category] || [];
      return [category, current.length === warm.length && current.every((node, index) => node === warm[index])];
    }));
    return {
      identity,
      dom: JSON.parse(JSON.stringify(window.__carouselDomWork)),
      work: JSON.parse(JSON.stringify(window.__carouselTestWork)),
      renderTokens: {
        gallery: document.querySelector('#galleryGrid')?.dataset.mediaWallRenderToken || '',
        video: document.querySelector('#videoGrid')?.dataset.mediaWallRenderToken || '',
      },
      soundMetrics: (() => {
        const grid = document.querySelector('#soundLabTracks');
        return [
          grid?.dataset.soundWallAvailableWidth || '',
          grid?.dataset.soundWallBaseWidth || '',
          grid?.dataset.soundWallResolvedWidth || '',
          grid?.dataset.soundWallGap || '',
          grid?.dataset.soundWallColumnCount || '',
          grid?.dataset.soundWallCapacity || '',
          grid?.style.gridTemplateColumns || '',
        ];
      })(),
    };
  });
}

async function probeHiddenCategoryLayout(page, category, panelSelector) {
  const before = await readWarmWork(page);
  const sameNodes = await page.locator(panelSelector).evaluate(async (panel, targetCategory) => {
    const waits = [];
    const grid = panel.querySelector(targetCategory === 'gallery'
      ? '#galleryGrid'
      : targetCategory === 'video'
        ? '#videoGrid'
        : '#soundLabTracks');
    const beforeNodes = Array.from(grid?.children || []);
    panel.style.display = 'none';
    document.dispatchEvent(new CustomEvent('bitbi:homepage-category-layout-request', {
      detail: {
        category: targetCategory,
        waitUntil(promise) {
          if (promise && typeof promise.then === 'function') waits.push(Promise.resolve(promise));
        },
      },
    }));
    await Promise.allSettled(waits);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    panel.style.display = '';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const afterNodes = Array.from(grid?.children || []);
    return beforeNodes.length === afterNodes.length
      && beforeNodes.every((node) => afterNodes.includes(node));
  }, category);
  return { before, after: await readWarmWork(page), sameNodes };
}

async function expectCarouselHorizontalFit(page, label) {
  const state = await page.locator('#homeCategories').evaluate((stage) => {
    const viewportWidth = document.documentElement.clientWidth;
    const visibleNodes = [stage, ...stage.querySelectorAll('[data-category-panel]')]
      .filter((node) => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    const rectOverflow = visibleNodes.reduce((largest, node) => {
      const rect = node.getBoundingClientRect();
      return Math.max(largest, Math.max(0, -rect.left), Math.max(0, rect.right - viewportWidth));
    }, 0);
    const offenders = Array.from(stage.querySelectorAll('*'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const grid = node.closest?.('#galleryGrid, #videoGrid, #soundLabTracks');
        const gridStyle = grid ? getComputedStyle(grid) : null;
        const parent = node.parentElement;
        return {
          node: node.id ? `#${node.id}` : `.${String(node.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`,
          overflow: Math.max(0, -rect.left, rect.right - viewportWidth),
          rectWidth: Math.round(rect.width * 100) / 100,
          inline: {
            width: node.style.width,
            minWidth: node.style.minWidth,
            maxWidth: node.style.maxWidth,
            inlineSize: node.style.inlineSize,
            flexBasis: node.style.flexBasis,
          },
          computed: {
            width: style.width,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            display: style.display,
            transform: style.transform,
          },
          parent: parent ? {
            className: String(parent.className || ''),
            width: getComputedStyle(parent).width,
            inlineWidth: parent.style.width,
            rectWidth: Math.round(parent.getBoundingClientRect().width * 100) / 100,
            transform: getComputedStyle(parent).transform,
          } : null,
          grid: grid ? {
            id: grid.id,
            rectWidth: Math.round(grid.getBoundingClientRect().width * 100) / 100,
            computedWidth: gridStyle.width,
            transform: gridStyle.transform,
            inlineTemplate: grid.style.gridTemplateColumns,
            computedTemplate: gridStyle.gridTemplateColumns,
            availableWidth: grid.dataset.mediaWallAvailableWidth || '',
            resolvedWidth: grid.dataset.mediaWallResolvedWidth || '',
            columns: grid.dataset.mediaWallColumnCount || '',
            ready: grid.dataset.mediaWallReady || '',
            renderToken: grid.dataset.mediaWallRenderToken || '',
          } : null,
        };
      })
      .filter((entry) => entry.overflow > 4)
      .sort((a, b) => b.overflow - a.overflow)
      .slice(0, 3);
    return {
      overflow: Math.max(rectOverflow, Math.max(0, stage.scrollWidth - stage.clientWidth)),
      stageClientWidth: stage.clientWidth,
      stageScrollWidth: stage.scrollWidth,
      publicWideMatch: matchMedia([
        '(min-width: 1024px) and (hover: hover) and (pointer: fine)',
        '(min-width: 768px) and (max-width: 1023px) and (min-height: 700px)',
        '(min-width: 1024px) and (hover: none) and (pointer: coarse) and (min-height: 700px)',
      ].join(', ')).matches,
      offenders,
    };
  });
  expect(state.overflow, `${label} ${JSON.stringify(state)}`).toBeLessThanOrEqual(4);
}

async function expectDirectionalTransition(page, { from, to, currentClass, nextClass }) {
  const link = page.locator(`#navbar .site-nav__links [data-category-link="${to}"]`);
  const box = await link.boundingBox();
  if (!box) throw new Error(`carousel link unavailable: ${to}`);
  await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
  await expect.poll(() => page.locator('#homeCategories').evaluate((stage) => {
    const current = stage.querySelector('.is-transition-current');
    const next = stage.querySelector('.is-transition-next');
    const viewport = stage.querySelector('.home-categories__viewport');
    return {
      current: current?.dataset.categoryPanel || '',
      next: next?.dataset.categoryPanel || '',
      currentClasses: current?.className || '',
      nextClasses: next?.className || '',
      perspective: viewport ? getComputedStyle(viewport).perspective : '',
      currentTransform: current ? getComputedStyle(current).transform : 'none',
      nextTransform: next ? getComputedStyle(next).transform : 'none',
    };
  }), { timeout: 5_000 }).toEqual(expect.objectContaining({
    current: from,
    next: to,
    currentClasses: expect.stringContaining(currentClass),
    nextClasses: expect.stringContaining(nextClass),
    perspective: '1800px',
  }));
  const visuals = await page.locator('#homeCategories').evaluate((stage) => ({
    currentTransform: getComputedStyle(stage.querySelector('.is-transition-current')).transform,
    nextTransform: getComputedStyle(stage.querySelector('.is-transition-next')).transform,
  }));
  expect(visuals.currentTransform).not.toBe('none');
  expect(visuals.nextTransform).not.toBe('none');
  await waitForSettledCategory(page, to);
}

async function measureWarmSwitch(page, category) {
  await page.evaluate((nextCategory) => {
    window.__carouselMeasurementPromise = new Promise((resolve, reject) => {
      const stage = document.getElementById('homeCategories');
      const viewport = stage?.querySelector('.home-categories__viewport');
      const link = document.querySelector(`#navbar .site-nav__links [data-category-link="${nextCategory}"]`);
      if (!stage || !viewport || !link) {
        reject(new Error('carousel measurement target missing'));
        return;
      }
      const startedAt = performance.now();
      let firstMotionAt = 0;
      let lastFrameAt = startedAt;
      let maxRafGapMs = 0;
      let rafSamples = 0;
      let viewportMinOpacity = 1;
      let frameId = 0;
      let timeoutId = 0;
      let settled = false;
      const clsStart = Number(window.__carouselTestWork?.cls || 0);
      const frame = (now) => {
        if (settled) return;
        if (rafSamples > 0) maxRafGapMs = Math.max(maxRafGapMs, now - lastFrameAt);
        lastFrameAt = now;
        rafSamples += 1;
        viewportMinOpacity = Math.min(viewportMinOpacity, Number.parseFloat(getComputedStyle(viewport).opacity) || 0);
        frameId = requestAnimationFrame(frame);
      };
      const finish = () => {
        if (settled || !firstMotionAt) return;
        if (stage.dataset.activeCategory !== nextCategory || stage.classList.contains('is-transitioning')) return;
        settled = true;
        observer.disconnect();
        cancelAnimationFrame(frameId);
        clearTimeout(timeoutId);
        const completedAt = performance.now();
        setTimeout(() => {
          const longTasks = (window.__carouselTestWork?.longTasks || [])
            .filter((entry) => entry.startTime >= startedAt && entry.startTime <= completedAt);
          resolve({
            firstMotionMs: firstMotionAt - startedAt,
            motionToCompleteMs: completedAt - firstMotionAt,
            maxRafGapMs,
            rafSamples,
            viewportMinOpacity,
            clsDelta: Number(window.__carouselTestWork?.cls || 0) - clsStart,
            longTaskSupported: !!window.__carouselTestWork?.longTaskSupported,
            longTaskCount: longTasks.length,
            maxLongTaskMs: longTasks.reduce((largest, entry) => Math.max(largest, entry.duration), 0),
          });
        }, 0);
      };
      const observer = new MutationObserver(() => {
        if (!firstMotionAt && stage.querySelector(`[data-category-panel="${nextCategory}"].is-enter-active`)) {
          firstMotionAt = performance.now();
        }
        finish();
      });
      observer.observe(stage, { attributes: true, attributeFilter: ['class', 'data-active-category'], subtree: true });
      frameId = requestAnimationFrame(frame);
      timeoutId = setTimeout(() => {
        observer.disconnect();
        cancelAnimationFrame(frameId);
        reject(new Error('carousel measurement timed out'));
      }, 3_000);
    });
  }, category);
  const link = page.locator(`#navbar .site-nav__links [data-category-link="${category}"]`);
  const box = await link.boundingBox();
  if (!box) throw new Error(`carousel link unavailable: ${category}`);
  await page.mouse.click(box.x + (box.width / 2), box.y + (box.height / 2));
  return page.evaluate(() => window.__carouselMeasurementPromise);
}

test.describe('Populated homepage carousel', () => {
  test.beforeEach(async ({ page }) => {
    await installCarouselWorkInstrumentation(page);
    await routePopulatedHomepage(page);
  });

  test('settles exact transitions, keeps populated walls warm, and honors the latest rapid choice', async ({ page, browserName }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForPopulatedHomepage(page);

    const initial = await readStageState(page);
    expect(initial.mode).toBe('desktop');
    expect(initial.engine).toBe('standard');
    await waitForSettledCategory(page, 'video');
    await waitForPublicWall(page, 'video');
    expect(CAROUSEL_CSS).toContain('perspective: 1800px;');
    expect(CAROUSEL_CSS).toContain('transition: height 0.52s');
    expect(CAROUSEL_CSS).toContain('transform 0.56s var(--ease-smooth)');
    expect(CAROUSEL_CSS).toContain('opacity: 0.04;');
    expect(CAROUSEL_CSS).toContain('translate3d(-108%, 0, 0) rotateY(14deg) scale(0.96)');
    expect(CAROUSEL_CSS).toContain('translate3d(108%, 0, 0) rotateY(-14deg) scale(0.96)');
    for (const retiredName of ['webkit-safe', 'is-webkit-motion', 'is-webkit-switching', 'home-category-webkit-safe-reveal']) {
      expect(`${CAROUSEL_CSS}\n${CAROUSEL_JS}`).not.toContain(retiredName);
    }
    const firstVideoCard = page.locator('#videoGrid .video-card').first();
    await firstVideoCard.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    const hoverPreview = firstVideoCard.locator('.video-card__hover-preview');
    await expect(hoverPreview).toHaveCount(1);
    await hoverPreview.dispatchEvent('loadeddata');
    await expect(firstVideoCard).toHaveClass(/video-card--hover-preview-active/);

    const transitionStartedAt = Date.now();
    await expectDirectionalTransition(page, {
      from: 'video',
      to: 'gallery',
      currentClass: 'is-leave-right',
      nextClass: 'is-from-left',
    });
    expect(Date.now() - transitionStartedAt).toBeLessThan(2_500);
    await waitForPublicWall(page, 'gallery');
    await expect(firstVideoCard.locator('.video-card__hover-preview')).toHaveCount(0);
    await expect(firstVideoCard).not.toHaveClass(/video-card--hover-preview-active/);

    await page.evaluate(() => document.fonts?.ready || Promise.resolve());
    await selectCategory(page, 'sound');
    await waitForSoundLayout(page);
    const firstSoundLayout = await readSoundLayout(page);
    const productionTestHooks = await page.locator('#soundLabTracks').evaluate((grid) => (
      Object.keys(grid.dataset).filter((key) => [
        'soundWidthApplyCount',
        'soundWidthCorrectionCount',
        'soundWidthUnchangedCount',
        'soundWidthValidationCount',
        'soundWidthZeroIgnoredCount',
      ].includes(key))
    ));
    expect(productionTestHooks).toEqual([]);
    await page.locator('#soundLabTracks .snd-card--memtrack .snd-play').first().evaluate((button) => button.click());
    await expect.poll(() => page.evaluate(async () => {
      const { getGlobalAudioState } = await import('/js/shared/audio/audio-manager.js?v=__ASSET_VERSION__');
      const state = getGlobalAudioState();
      return `${state.trackId || ''}|${state.status || ''}|${String(!!state.playIntent)}`;
    })).toBe('memtrack:carousel-memtrack-1|playing|true');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const audioBeforeWarmCycle = await page.evaluate(async () => {
      const { getGlobalAudioState } = await import('/js/shared/audio/audio-manager.js?v=__ASSET_VERSION__');
      const state = getGlobalAudioState();
      return { trackId: state.trackId, status: state.status, playIntent: state.playIntent };
    });
    await startWarmDomTracking(page);
    const beforeWarmCycle = await readWarmWork(page);
    await page.waitForTimeout(300);

    const warmMeasurements = [];
    warmMeasurements.push(await measureWarmSwitch(page, 'video'));
    await waitForPublicWall(page, 'video');
    warmMeasurements.push(await measureWarmSwitch(page, 'gallery'));
    await waitForPublicWall(page, 'gallery');
    warmMeasurements.push(await measureWarmSwitch(page, 'sound'));
    await waitForSoundLayout(page);
    await page.waitForTimeout(200);
    const repeatedSoundLayout = await readSoundLayout(page);
    const afterWarmCycle = await readWarmWork(page);
    expect(repeatedSoundLayout.metrics.slice(0, 6)).toEqual(firstSoundLayout.metrics.slice(0, 6));
    const firstCardWidth = Number.parseFloat(firstSoundLayout.widths[0]?.width || '0');
    const repeatedCardWidth = Number.parseFloat(repeatedSoundLayout.widths[0]?.width || '0');
    expect(Math.abs(repeatedCardWidth - firstCardWidth)).toBeLessThanOrEqual(1);
    expect(new Set(repeatedSoundLayout.widths.map((entry) => entry.width)).size).toBe(1);
    expect(afterWarmCycle.identity).toEqual({ gallery: true, video: true, sound: true });
    expect(afterWarmCycle.renderTokens).toEqual(beforeWarmCycle.renderTokens);
    expect(afterWarmCycle.soundMetrics.slice(0, 6)).toEqual(beforeWarmCycle.soundMetrics.slice(0, 6));
    expect(afterWarmCycle.dom.childMutations).toEqual({ gallery: 0, video: 0, sound: 0 });
    expect(afterWarmCycle.dom.styleMutations).toEqual({ gallery: 0, video: 0, sound: 0 });
    expect(afterWarmCycle.work.replaceChildren).toEqual(beforeWarmCycle.work.replaceChildren);
    expect(afterWarmCycle.work.innerHtmlWrites).toEqual(beforeWarmCycle.work.innerHtmlWrites);
    expect(afterWarmCycle.work.cardRectReads).toEqual(beforeWarmCycle.work.cardRectReads);
    const audioAfterWarmCycle = await page.evaluate(async () => {
      const { getGlobalAudioState } = await import('/js/shared/audio/audio-manager.js?v=__ASSET_VERSION__');
      const state = getGlobalAudioState();
      return { trackId: state.trackId, status: state.status, playIntent: state.playIntent };
    });
    expect(audioAfterWarmCycle).toEqual(audioBeforeWarmCycle);
    const sortedFirstMotion = warmMeasurements.map((entry) => entry.firstMotionMs).sort((a, b) => a - b);
    const p95FirstMotion = sortedFirstMotion[Math.ceil(sortedFirstMotion.length * 0.95) - 1];
    const metrics = { browserName, p95FirstMotion, warmMeasurements };
    await testInfo.attach('carousel-metrics', {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: 'application/json',
    });
    console.log(`carousel-metrics ${JSON.stringify(metrics)}`);
    expect(p95FirstMotion).toBeLessThanOrEqual(100);
    for (const measurement of warmMeasurements) {
      expect(measurement.motionToCompleteMs).toBeGreaterThanOrEqual(440);
      expect(measurement.motionToCompleteMs).toBeLessThanOrEqual(680);
      expect(measurement.viewportMinOpacity).toBeGreaterThanOrEqual(0.99);
      expect(measurement.clsDelta).toBeLessThanOrEqual(0.01);
      if (measurement.longTaskSupported) {
        expect(measurement.maxLongTaskMs).toBeLessThanOrEqual(50);
      }
    }
    await expectSingleInteractivePanel(page, 'sound');

    await selectCategory(page, 'video');
    const rapidClsBaseline = await page.evaluate(() => window.__carouselTestWork.cls);
    const rapidStartedAt = Date.now();
    const galleryBox = await page.locator('#navbar .site-nav__links [data-category-link="gallery"]').boundingBox();
    const soundBox = await page.locator('#navbar .site-nav__links [data-category-link="sound"]').boundingBox();
    if (!galleryBox || !soundBox) throw new Error('rapid carousel controls unavailable');
    await page.mouse.click(galleryBox.x + (galleryBox.width / 2), galleryBox.y + (galleryBox.height / 2));
    await page.mouse.click(soundBox.x + (soundBox.width / 2), soundBox.y + (soundBox.height / 2));
    await waitForSettledCategory(page, 'sound');
    expect(Date.now() - rapidStartedAt).toBeLessThan(2_500);
    const cls = await page.evaluate(() => window.__carouselTestWork.cls);
    expect(cls - rapidClsBaseline).toBeLessThanOrEqual(0.01);
    await expectSingleInteractivePanel(page, 'sound');

    const wideGallery = await page.locator('#galleryGrid').evaluate((grid) => ({
      token: grid.dataset.mediaWallRenderToken || '',
      columns: Number(grid.dataset.mediaWallColumnCount || 0),
      ids: Array.from(grid.querySelectorAll('.gallery-item')).map((card) => card.dataset.galleryItemId || '').sort(),
    }));
    await page.setViewportSize({ width: 1100, height: 900 });
    await selectCategory(page, 'gallery');
    await waitForPublicWall(page, 'gallery');
    const narrowGallery = await page.locator('#galleryGrid').evaluate((grid) => ({
      token: grid.dataset.mediaWallRenderToken || '',
      columns: Number(grid.dataset.mediaWallColumnCount || 0),
      ids: Array.from(grid.querySelectorAll('.gallery-item')).map((card) => card.dataset.galleryItemId || '').sort(),
    }));
    expect(narrowGallery.token).not.toBe(wideGallery.token);
    expect(narrowGallery.columns).toBeLessThan(wideGallery.columns);
    expect(narrowGallery.ids).toEqual(wideGallery.ids);
    await selectCategory(page, 'video');
    await selectCategory(page, 'gallery');
    await waitForPublicWall(page, 'gallery');
    const stableNarrowToken = await page.locator('#galleryGrid').evaluate((grid) => grid.dataset.mediaWallRenderToken || '');
    expect(stableNarrowToken).toBe(narrowGallery.token);
  });

  test('uses transform-invariant wall geometry and recovers a pending zero-width layout', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const initial = await page.evaluate(async () => {
      const {
        calculateFixedMediaWallMetrics,
        renderFixedMediaWallColumns,
      } = await import('/js/pages/index/public-media-wall.js?v=__ASSET_VERSION__');
      const host = document.createElement('div');
      host.id = 'mediaWallGeometryFixture';
      host.style.cssText = 'display:none;width:1395px;padding:0;';
      const grid = document.createElement('div');
      grid.id = 'mediaWallGeometryGrid';
      grid.style.cssText = 'display:grid;width:100%;column-gap:2px;';
      grid.style.setProperty('--fixture-column-width', '297px');
      const cards = Array.from({ length: 5 }, (_, index) => {
        const card = document.createElement('div');
        card.dataset.fixtureCard = String(index);
        card.style.cssText = 'height:200px;';
        card.style.setProperty('--fixture-aspect', '1.4');
        return card;
      });
      host.appendChild(grid);
      document.body.appendChild(host);
      const options = {
        countProperty: '--fixture-column-count',
        targetWidthProperty: '--fixture-column-width',
        fallbackColumnWidth: 297,
        aspectProperty: '--fixture-aspect',
        fallbackAspectRatio: 1.4,
        contentSignature: 'fixture-v1',
      };
      renderFixedMediaWallColumns(grid, cards, options);
      const hidden = {
        ready: grid.dataset.mediaWallReady,
        width: grid.dataset.mediaWallAvailableWidth || '',
        columns: grid.querySelectorAll(':scope > .public-media-wall__column').length,
      };
      host.style.display = 'block';
      const beforeTransform = calculateFixedMediaWallMetrics(grid, {
        targetWidthProperty: '--fixture-column-width',
        fallbackColumnWidth: 297,
        itemCount: cards.length,
      });
      host.style.transform = 'translate3d(180px, 0, 0) rotateY(14deg) scale(0.72)';
      const duringTransform = calculateFixedMediaWallMetrics(grid, {
        targetWidthProperty: '--fixture-column-width',
        fallbackColumnWidth: 297,
        itemCount: cards.length,
      });
      renderFixedMediaWallColumns(grid, cards, options);
      const renderToken = grid.dataset.mediaWallRenderToken;
      host.style.visibility = 'hidden';
      return {
        hidden,
        beforeTransform,
        duringTransform,
        renderToken,
      };
    });

    expect(initial.hidden).toEqual({ ready: 'false', width: '', columns: 0 });
    expect(initial.duringTransform.availableWidthPx).toBe(initial.beforeTransform.availableWidthPx);
    expect(initial.duringTransform.resolvedWidthPx).toBe(initial.beforeTransform.resolvedWidthPx);
    expect(initial.duringTransform.columnCount).toBe(initial.beforeTransform.columnCount);
    await page.waitForTimeout(100);
    await expect(page.locator('#mediaWallGeometryGrid')).toHaveAttribute('data-media-wall-ready', 'false');

    const recovery = await page.evaluate(async () => {
      const { renderFixedMediaWallColumns } = await import('/js/pages/index/public-media-wall.js?v=__ASSET_VERSION__');
      const host = document.getElementById('mediaWallGeometryFixture');
      const grid = document.getElementById('mediaWallGeometryGrid');
      const cards = Array.from(grid.querySelectorAll('[data-fixture-card]'))
        .sort((left, right) => Number(left.dataset.fixtureCard) - Number(right.dataset.fixtureCard));
      host.style.visibility = 'visible';
      renderFixedMediaWallColumns(grid, cards, {
        countProperty: '--fixture-column-count',
        targetWidthProperty: '--fixture-column-width',
        fallbackColumnWidth: 297,
        aspectProperty: '--fixture-aspect',
        fallbackAspectRatio: 1.4,
        contentSignature: 'fixture-v1',
      });
      return {
        renderToken: grid.dataset.mediaWallRenderToken,
        columns: grid.querySelectorAll(':scope > .public-media-wall__column').length,
        width: Number(grid.dataset.mediaWallAvailableWidth || 0),
      };
    });
    expect(recovery.renderToken).toBe(initial.renderToken);
    expect(recovery.columns).toBeGreaterThan(1);
    expect(recovery.width).toBe(1395);
    await expect(page.locator('#mediaWallGeometryGrid')).toHaveAttribute('data-media-wall-ready', 'true');
  });

  test('ignores transient zero width and preserves reduced-motion, mobile, and localized layouts', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForPopulatedHomepage(page);
    await selectCategory(page, 'sound');
    await waitForSoundLayout(page);
    await startWarmDomTracking(page);
    const beforeHiddenProbe = await readWarmWork(page);

    await page.locator('#soundlab').evaluate(async (panel) => {
      panel.style.display = 'none';
      document.dispatchEvent(new CustomEvent('bitbi:homepage-category-layout-request', {
        detail: { category: 'sound', waitUntil() {} },
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      panel.style.display = '';
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const afterHiddenProbe = await readWarmWork(page);
    expect(afterHiddenProbe.soundMetrics).toEqual(beforeHiddenProbe.soundMetrics);
    expect(afterHiddenProbe.identity.sound).toBe(true);
    expect(afterHiddenProbe.dom.childMutations.sound).toBe(0);
    expect(afterHiddenProbe.dom.styleMutations.sound).toBe(0);
    expect(afterHiddenProbe.work.cardRectReads.sound).toBe(beforeHiddenProbe.work.cardRectReads.sound);

    await selectCategory(page, 'gallery');
    await waitForPublicWall(page, 'gallery');
    const galleryProbe = await probeHiddenCategoryLayout(page, 'gallery', '#gallery');
    expect(galleryProbe.after.renderTokens.gallery).toBe(galleryProbe.before.renderTokens.gallery);
    expect(galleryProbe.sameNodes).toBe(true);
    expect(galleryProbe.after.dom.childMutations.gallery).toBe(galleryProbe.before.dom.childMutations.gallery);
    expect(galleryProbe.after.dom.styleMutations.gallery).toBe(galleryProbe.before.dom.styleMutations.gallery);

    await selectCategory(page, 'video');
    await waitForPublicWall(page, 'video');
    const videoProbe = await probeHiddenCategoryLayout(page, 'video', '#video-creations');
    expect(videoProbe.after.renderTokens.video).toBe(videoProbe.before.renderTokens.video);
    expect(videoProbe.sameNodes).toBe(true);
    expect(videoProbe.after.dom.childMutations.video).toBe(videoProbe.before.dom.childMutations.video);
    expect(videoProbe.after.dom.styleMutations.video).toBe(videoProbe.before.dom.styleMutations.video);

    const instantState = await page.evaluate(() => {
      document.querySelector('#navbar .site-nav__links [data-category-link="gallery"]')?.click();
      const stage = document.getElementById('homeCategories');
      return {
        active: stage?.dataset.activeCategory || '',
        engine: stage?.dataset.motionEngine || '',
        transitioning: stage?.classList.contains('is-transitioning') || false,
        height: stage?.querySelector('.home-categories__viewport')?.style.height || '',
      };
    });
    expect(instantState).toEqual({ active: 'gallery', engine: 'instant', transitioning: false, height: '' });

    const responsiveCases = [
      { pathName: '/', viewport: { width: 390, height: 844 }, mode: 'stacked', deck: true },
      { pathName: '/de/', viewport: { width: 390, height: 844 }, mode: 'stacked', deck: true },
      { pathName: '/', viewport: { width: 844, height: 390 }, mode: 'stacked', deck: false },
      { pathName: '/', viewport: { width: 767, height: 1024 }, mode: 'stacked', deck: false },
      { pathName: '/de/', viewport: { width: 820, height: 1180 }, mode: 'desktop', deck: false },
    ];
    for (const { pathName, viewport, mode, deck } of responsiveCases) {
      await page.setViewportSize(viewport);
      await waitForPopulatedHomepage(page, pathName);
      const mobileState = await readStageState(page);
      expect(mobileState.mode).toBe(mode);
      expect(mobileState.transitioning).toBe(false);
      if (deck) {
        await expect(page.locator('#soundLabTracks')).toHaveClass(/snd-deck/);
        await expect(page.locator('#soundLabTracks .snd-card--memtrack').first()).toBeVisible();
      } else {
        await expect(page.locator('#soundLabTracks')).not.toHaveClass(/snd-deck/);
      }
      await expectCarouselHorizontalFit(page, `${pathName} ${viewport.width}x${viewport.height}`);
    }

    await page.setViewportSize({ width: 767, height: 1024 });
    await expect.poll(() => readStageState(page)).toMatchObject({ mode: 'stacked', transitioning: false });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectCarouselHorizontalFit(page, 'dynamic 767x1024 stacked');
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect.poll(() => readStageState(page)).toMatchObject({ mode: 'desktop', transitioning: false });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectCarouselHorizontalFit(page, 'dynamic 820x1180 staged');

    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForPopulatedHomepage(page, '/de/#soundlab');
    await waitForSettledCategory(page, 'sound');
    await waitForSoundLayout(page);
    expect(new URL(page.url()).hash).toBe('#soundlab');
    await expectSingleInteractivePanel(page, 'sound');
  });
});
