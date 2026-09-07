const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installHeroNativeProbe, everyActiveSlotProgressed } = require('./helpers/homepage-hero-native-probe');

const VIDEO = fs.readFileSync(path.join(__dirname, 'fixtures/media/test-video.mp4'));
const POSTER = fs.readFileSync(path.join(__dirname, 'fixtures/media/favorite-thumb.jpg'));
const HERO_VIDEOS = '#hero [data-latest-models-video-module] video';
const HERO_SLOTS = '#hero [data-latest-models-slot]';
const SLOT_NAMES = ['right_top', 'right_bottom', 'left_top', 'left_bottom'];

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  const events = await page.evaluate(() => window.__heroNativeProbe?.events ?? null);
  if (events) await testInfo.attach('native-media-events', { body: JSON.stringify(events), contentType: 'application/json' });
});

async function fixture(page, { configured = true, initiallyHidden = false } = {}) {
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installHeroNativeProbe(page);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.addInitScript(({ initiallyHidden }) => {
    localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, timestamp: Date.now() }));
    // A deterministic visibility event exercises app policy without relying on
    // headless background-tab throttling. Media play/pause/decoding remain native.
    window.__setHeroDocumentHidden = hidden => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    if (initiallyHidden) window.__setHeroDocumentHidden(true);
  }, { initiallyHidden });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push(url.pathname);
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/api/me') return json({ loggedIn: false, user: null });
    if (url.pathname === '/api/public/news-pulse') return json({ items: [], updated_at: '2026-05-09T00:00:00.000Z' });
    if (url.pathname === '/api/homepage/hero-videos') {
      return json({ ok: true, data: { configured, slots: configured ? SLOT_NAMES.map(slot => ({
        slot, version: 'playback-v1',
        file: { url: `/api/homepage/hero-videos/${slot}/playback-v1/file` },
        poster: { url: `/api/homepage/hero-videos/${slot}/playback-v1/poster` },
      })) : [] } });
    }
    if (url.pathname === '/api/gallery/memvids') {
      return json({ ok: true, data: { items: Array.from({ length: 10 }, (_, index) => ({
        id: `playback-${index}`, slug: `playback-${index}`, category: 'memvids',
        published_at: `2026-05-${String(20 - index).padStart(2, '0')}T08:00:00.000Z`,
        file: { url: `/api/gallery/memvids/playback-${index}/v1/file` },
        poster: { url: `/api/gallery/memvids/playback-${index}/v1/poster`, w: 320, h: 180 },
      })), has_more: false, next_cursor: null } });
    }
    // Match the existing public Hero/Memvid full-response contract. Do not turn
    // Range requests into 206 here: those product handlers currently return 200.
    if (url.pathname.endsWith('/file')) return route.fulfill({
      status: 200, contentType: 'video/mp4', body: VIDEO,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
    if (url.pathname.endsWith('/poster')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: POSTER });
    return json({ ok: true, data: { items: [], has_more: false, next_cursor: null } });
  });
  return { requests, errors };
}

async function openHome(page, locale, options) {
  const state = await fixture(page, options);
  await page.goto(locale === 'de' ? '/de/' : '/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(HERO_VIDEOS)).toHaveCount(4);
  await expect(page.locator('#hero [data-video-module-state="ready"]')).toHaveCount(2);
  await expect(page.locator('#hero .latest-models-video-module__label').first())
    .toHaveText(locale === 'de' ? 'Plattform Modelle' : 'Platform Models');
  return state;
}

async function snapshot(page) {
  return page.locator(HERO_VIDEOS).evaluateAll(videos => videos.map(video => ({
    time: video.currentTime,
    frames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? null,
    paused: video.paused,
    src: video.getAttribute('src'),
  })));
}

async function expectPlaying(page) {
  const baseline = new Map();
  const samples = [];
  try {
    await expect.poll(async () => {
      const current = await page.evaluate(() => window.__heroNativeProbe.sample());
      samples.push(current);
      const progressed = everyActiveSlotProgressed([...baseline.values()], current);
      current.forEach(video => { if (!baseline.has(video.id)) baseline.set(video.id, video); });
      return progressed;
    }).toBe(true);
  } finally {
    await test.info().attach('native-active-slot-progress', {
      body: JSON.stringify({ samples }),
      contentType: 'application/json',
    });
  }
}

async function startContinuityProbe(page) {
  await page.evaluate(selector => {
    const videos = Array.from(document.querySelectorAll(selector));
    const probe = { videos, sources: videos.map(video => video.getAttribute('src')), sourceChanges: 0, emptied: 0, resumes: [] };
    videos.forEach(video => {
      // The single pass-through native observer captures resume before a due
      // cycle can add a face. Repeated probes do not wrap play a second time.
      video.addEventListener('emptied', () => { probe.emptied += 1; });
      new MutationObserver(records => { probe.sourceChanges += records.length; })
        .observe(video, { attributes: true, attributeFilter: ['src'] });
    });
    window.__heroContinuityProbe = probe;
  }, HERO_VIDEOS);
}

async function expectNativeResumeContinuity(page, testInfo, label) {
  const resumes = await page.evaluate(() => window.__heroContinuityProbe.resumes);
  expect(resumes.length, `${label}: native resume observed`).toBeGreaterThan(0);
  for (const resume of resumes) {
    expect(resume).toEqual({ sameVideos: true, sameSources: true, sourceChanges: 0, emptied: 0 });
  }
  await testInfo.attach(label, { body: JSON.stringify(resumes), contentType: 'application/json' });
}

async function suspendAtNativeTurn(page) {
  await page.evaluate(selector => {
    const observer = new MutationObserver(suspend);
    function suspend() {
      if (!document.querySelector(`${selector}.is-turning`)) return;
      observer.disconnect();
      // Capture the actual turn in the same DOM update, not a later driver task
      // which might already be beyond animationend or its fallback deadline.
      window.__setHeroDocumentHidden(true);
    }
    observer.observe(document.querySelector('#hero'), { attributes: true, attributeFilter: ['class'], subtree: true });
    suspend();
  }, HERO_SLOTS);
  await expect(page.locator(`${HERO_SLOTS}.is-turning`).first()).toBeAttached({ timeout: 3000 });
}

async function expectContinuity(page) {
  expect(await page.evaluate(selector => {
    const probe = window.__heroContinuityProbe;
    const current = Array.from(document.querySelectorAll(selector));
    return {
      sameVideos: current.length === probe.videos.length && current.every((video, index) => video === probe.videos[index]),
      sameSources: probe.videos.every((video, index) => video.getAttribute('src') === probe.sources[index]),
      sourceChanges: probe.sourceChanges,
      emptied: probe.emptied,
    };
  }, HERO_VIDEOS)).toEqual({ sameVideos: true, sameSources: true, sourceChanges: 0, emptied: 0 });
}

async function expectFrozen(page, testInfo, label, duration = 450) {
  await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
  // Let the decoder finish any frame already in flight before sampling.
  await page.waitForTimeout(150);
  const before = await snapshot(page);
  await page.waitForTimeout(duration);
  const after = await snapshot(page);
  expect(after).toHaveLength(before.length);
  after.forEach((video, index) => {
    expect(Math.abs(video.time - before[index].time), `${label}: currentTime ${index}`).toBeLessThan(0.01);
    if (video.frames !== null && before[index].frames !== null) {
      expect(video.frames - before[index].frames, `${label}: decoded frames ${index}`).toBeLessThanOrEqual(1);
    }
  });
  await testInfo.attach(label, { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
}

async function scrollHeroOffscreen(page) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, document.querySelector('#hero').getBoundingClientRect().bottom + window.scrollY + 100);
  });
  await expect.poll(() => page.locator('#hero').evaluate(hero => hero.getBoundingClientRect().bottom)).toBeLessThan(0);
}

for (const locale of ['en', 'de']) {
  test(`${locale}: configured native media loops in every slot with the existing full-response file contract`, async ({ page }, testInfo) => {
    await openHome(page, locale);
    await expectPlaying(page);
    const initial = await page.evaluate(() => window.__heroNativeProbe.sample());
    expect(initial.every(video => video.duration === 1)).toBe(true);
    // The same one-second MP4 must play beyond its first complete decode in all
    // four slots. An initial playing state does not establish looping support.
    await expect.poll(async () => {
      const current = await page.evaluate(() => window.__heroNativeProbe.sample());
      return everyActiveSlotProgressed(initial, current) && current.every(video => {
        const first = initial.find(item => item.id === video.id);
        return first && video.frames !== null && first.frames !== null && video.frames - first.frames >= 24;
      });
    }).toBe(true);
    await testInfo.attach('native-full-response-loop', {
      body: JSON.stringify({ initial, current: await page.evaluate(() => window.__heroNativeProbe.sample()) }),
      contentType: 'application/json',
    });
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'native-loop-suspended', 200);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expectPlaying(page);
  });

  test(`${locale}: configured hero pauses offscreen and hidden, resumes existing media and respects an existing pause`, async ({ page }, testInfo) => {
    const state = await openHome(page, locale);
    await expectPlaying(page);
    await startContinuityProbe(page);
    const initial = await snapshot(page);
    await page.waitForTimeout(250);
    const playing = await snapshot(page);
    expect(playing.some((video, index) => video.time !== initial[index].time)).toBe(true);
    await testInfo.attach('visible-native-playback', { body: JSON.stringify({ initial, playing }, null, 2), contentType: 'application/json' });

    await scrollHeroOffscreen(page);
    await expectFrozen(page, testInfo, 'offscreen-native-playback');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectPlaying(page);
    await expectContinuity(page);

    // A separate controlled player stays outside the decorative hero lifecycle.
    await page.evaluate(async () => {
      const video = document.createElement('video');
      video.id = 'independent-controlled-video';
      video.controls = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.src = '/api/gallery/memvids/independent/v1/file';
      video.style.cssText = 'position:fixed;inset:100px auto auto 0;width:24px;height:24px;z-index:9999';
      document.body.append(video);
      await video.play();
    });
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'synthetic-hidden-native-playback');
    expect(await page.locator('#independent-controlled-video').evaluate(video => video.paused)).toBe(false);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expectPlaying(page);
    await expectContinuity(page);

    await page.locator(HERO_VIDEOS).first().evaluate(video => video.pause());
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'hidden-after-existing-pause', 200);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.map(video => video.paused)))
      .toEqual([true, false, false, false]);
    await expectContinuity(page);
    expect(state.errors).toEqual([]);
  });

  test(`${locale}: fallback freezes media and its staggered cycle while suspended`, async ({ page }, testInfo) => {
    const state = await openHome(page, locale, { configured: false });
    await expectPlaying(page);
    await scrollHeroOffscreen(page);
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
    // The offscreen observer is asynchronous. The frozen interval begins at
    // confirmed suspension, not at a driver sample that may precede a due turn.
    await startContinuityProbe(page);
    const cyclesBefore = await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount));
    await expectFrozen(page, testInfo, 'fallback-offscreen-native-playback', 2400);
    expect(await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount))).toEqual(cyclesBefore);
    await expectContinuity(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectPlaying(page);
    await expectNativeResumeContinuity(page, testInfo, 'fallback-native-resume');

    // Suspension during an actual cube turn retains both faces and resumes it.
    await suspendAtNativeTurn(page);
    expect(await page.locator(HERO_SLOTS).evaluateAll(slots => slots.some(slot => Number(slot.dataset.transitionCount) > 0))).toBe(true);
    await startContinuityProbe(page);
    const duringTurn = await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount));
    await expectFrozen(page, testInfo, 'fallback-hidden-during-transition', 1250);
    expect(await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount))).toEqual(duringTurn);
    await expectContinuity(page);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expectPlaying(page);
    await expectNativeResumeContinuity(page, testInfo, 'fallback-native-turn-resume');
    await expect(page.locator(`${HERO_SLOTS}.is-turning`)).toHaveCount(0, { timeout: 2000 });
    expect(state.errors).toEqual([]);
  });

  test(`${locale}: hidden initialization and bfcache restore preserve media; ordinary pagehide cleans up`, async ({ page }, testInfo) => {
    const state = await openHome(page, locale, { initiallyHidden: true });
    await startContinuityProbe(page);
    await expectFrozen(page, testInfo, 'initial-hidden-native-playback', 200);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expectPlaying(page);
    await expectContinuity(page);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await expectFrozen(page, testInfo, `bfcache-hidden-${cycle}`, 200);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expectPlaying(page);
      await expectContinuity(page);
    }
    // Listener reattachment is observable after the bfcache round trips.
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'hidden-after-bfcache', 200);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expectPlaying(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(0);
    expect(await page.evaluate(() => window.__heroContinuityProbe.videos.every(video => video.paused && !video.hasAttribute('src')))).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForTimeout(150);
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(0);
    expect(state.requests.filter(url => url === '/api/homepage/hero-videos')).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });

  test(`${locale}: phone and tablet breakpoints retain existing policy with reduced motion`, async ({ page }, testInfo) => {
    await fixture(page, { configured: false });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(locale === 'de' ? '/de/' : '/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.auth-modal__overlay')).toBeAttached();
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(0);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(4);
    await expectPlaying(page);
    await expect.poll(() => page.locator(HERO_SLOTS).evaluateAll(slots => slots.some(slot => Number(slot.dataset.transitionCount) > 0)), { timeout: 3000 }).toBe(true);
    await expect(page.locator(`${HERO_SLOTS}.is-turning`)).toHaveCount(0);
    await scrollHeroOffscreen(page);
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
    await startContinuityProbe(page);
    await expectFrozen(page, testInfo, 'tablet-reduced-motion-offscreen');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectPlaying(page);
    await expectNativeResumeContinuity(page, testInfo, 'reduced-motion-native-resume');
    await page.setViewportSize({ width: 820, height: 650 });
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(4);
    await expectPlaying(page);
  });
}
