const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installHeroNativeProbe } = require('./helpers/homepage-hero-native-probe');

const VIDEO = fs.readFileSync(path.join(__dirname, 'fixtures/media/test-video.mp4'));
const POSTER = fs.readFileSync(path.join(__dirname, 'fixtures/media/favorite-thumb.jpg'));
const HERO_VIDEOS = '#hero [data-latest-models-video-module] video';
const HERO_SLOTS = '#hero [data-latest-models-slot]';
const SLOT_NAMES = ['right_top', 'right_bottom', 'left_top', 'left_bottom'];
const transports = new WeakMap();

test.afterEach(async ({ page }, testInfo) => {
  const transport=transports.get(page);
  if(transport) {
    await testInfo.attach('media-http-transport',{body:JSON.stringify(transport),contentType:'application/json'});
    if(transport.mode==='http') {
      const complete=transport.responses.filter(r=>[200,206].includes(r.status)&&!r.broken);
      expect(complete.every(r=>r.transport==='http')).toBe(true);
    }
  }
  if (page.isClosed()) return;
  const events = await page.evaluate(() => window.__heroNativeProbe?.events ?? null);
  if (events) await testInfo.attach('native-media-events', { body: JSON.stringify(events), contentType: 'application/json' });
  const details = await page.evaluate(() => window.__heroNativeProbe?.diagnostics?.() ?? null);
  if (details) await testInfo.attach('native-media-final-details', { body: JSON.stringify(details), contentType: 'application/json' });
});

async function fixture(page, { configured = true, initiallyHidden = false, transport = 'http', broken = false } = {}) {
  const { publicVideoResponse } = await import('../workers/auth/src/lib/public-video-response.mjs');
  const requests = [];
  const errors = [];
  const transportEvidence={mode:transport,responses:[]};transports.set(page,transportEvidence);
  page.on('response', response=>{
    const url=new URL(response.url());
    if(url.pathname.endsWith('/file')) transportEvidence.responses.push({path:url.pathname,broken:url.searchParams.has('broken'),status:response.status(),transport:response.headers()['x-test-media-transport']||null});
  });
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
  // File requests in the positive HTTP path have no Playwright route handler.
  await page.route(/^(?!http:\/\/(?:localhost|127\.0\.0\.1):3000\/)/, route => route.abort());
  const apiPattern = transport === 'http' ? /\/api\/(?!.*\/file(?:[?#]|$))/ : /\/api\//;
  await page.route(apiPattern, async route => {
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
        file: { url: `/api/homepage/hero-videos/${slot}/playback-v1/file${broken ? '?broken=1' : ''}` },
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
    if (url.pathname.endsWith('/file')) {
      const metadata = { size: VIDEO.length, etag: 'fixture-video', httpEtag: '"fixture-video"', uploaded: new Date('2026-09-07T00:00:00Z') };
      const response = await publicVideoResponse(new Request(url, { headers: route.request().headers() }), {
        head: async () => metadata,
        get: async (key, options) => ({ ...metadata, body: options?.range
          ? VIDEO.subarray(options.range.offset, options.range.offset + options.range.length) : VIDEO }),
      }, 'synthetic-video', () => new Headers({ 'Content-Type':'video/mp4','Content-Length':String(VIDEO.length),
        'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff' }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
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

async function expectPlaying(page) {
  const result = await page.evaluate(() => window.__heroNativeProbe.waitForProgress());
  await test.info().attach('native-active-slot-progress', {
    body: JSON.stringify(result), contentType: 'application/json',
  });
  expect(result.passed, `${result.phase}: ${JSON.stringify(result.issues)}`).toBe(true);
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
  let result;
  try {
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.length >= 4 && videos.every(video => video.paused))).toBe(true);
    result = await page.evaluate(duration => window.__heroNativeProbe.observeFrozen(duration), duration);
  } finally {
    // Raw evidence also survives a failure to enter the paused phase.
    result ||= { phase: 'pause-not-confirmed', samples: await page.evaluate(() => window.__heroNativeProbe.sample()) };
    await testInfo.attach(label, { body: JSON.stringify(result), contentType: 'application/json' });
  }
  expect(result.issues, label).toEqual([]);
  expect(result.passed, label).toBe(true);
}

async function scrollHeroOffscreen(page) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, document.querySelector('#hero').getBoundingClientRect().bottom + window.scrollY + 100);
  });
  await expect.poll(() => page.locator('#hero').evaluate(hero => hero.getBoundingClientRect().bottom)).toBeLessThan(0);
}

// The intercepted transport is diagnostic only. The real HTTP path must pass
// the same native loop/seek/resume contract, before testing the actual Hero.
for (const transport of ['fulfill', 'http']) {
  test(`native plain video: ${transport === 'http' ? 'HTTP response loops and seeks' : 'fulfill transport comparison'}`, { tag: '@homepage-extended' }, async ({ page, browserName }, testInfo) => {
    await fixture(page, { transport });
    const requests = [];
    page.on('response', response => {
      if (response.url().includes('/plain/file')) requests.push({ status:response.status(),range:response.request().headers().range || null,
        contentRange:response.headers()['content-range'] || null,length:response.headers()['content-length'] || null,transport:response.headers()['x-test-media-transport'] || null });
    });
    await page.goto('/plain-video');
    await page.evaluate(() => { document.body.replaceChildren(); const video=document.createElement('video');video.id='plain';video.muted=true;video.playsInline=true;video.loop=true;video.controls=true;document.body.append(video); });
    const result=await page.evaluate(async () => {
      const v=document.querySelector('#plain');v.src='/api/plain/file';
      const probe=window.__heroNativeProbe;
      const baseline=probe.observe(v);const samples=[];
      const waitFor=predicate=>new Promise(resolve=>{
        const deadline=performance.now()+4500;
        const inspect=()=>{const sample=probe.observe(v);samples.push(sample);if(predicate(sample)||v.error||performance.now()>deadline)resolve(sample);else requestAnimationFrame(inspect);};inspect();
      });
      let rejected=null;try{await v.play();}catch(error){rejected=error.name;}
      const initial=await waitFor(s=>s.completedLoops-baseline.completedLoops>=2);
      let resumed=false,seeked=false;
      if(!v.error&&initial.completedLoops-baseline.completedLoops>=2){
        v.pause();
        const seek=new Promise(resolve=>{v.addEventListener('seeked',()=>resolve(true),{once:true});setTimeout(()=>resolve(false),1000);});
        v.currentTime=0.3;seeked=await seek;
        const before=probe.observe(v);try{await v.play();}catch(error){rejected=error.name;}
        const after=await waitFor(s=>s.outputAdvances>before.outputAdvances);
        resumed=after.outputAdvances>before.outputAdvances;
      }
      v.pause();return{initial,resumed,seeked,rejected,error:v.error?.code||null,samples};
    });
    await testInfo.attach('plain-native-transport',{body:JSON.stringify({browserName,transport,requests,result}),contentType:'application/json'});
    if(transport==='http') {
      expect(requests.some(r=>r.transport==='http')).toBe(true);
      expect(result.initial.completedLoops).toBeGreaterThanOrEqual(2);expect(result.error).toBeNull();expect(result.rejected).toBeNull();expect(result.seeked).toBe(true);expect(result.resumed).toBe(true);
    } else {
      // A measured interception stall remains a diagnostic failure, not native
      // product acceptance. A broken observer/test setup still fails this test.
      expect(requests.length).toBeGreaterThan(0);expect(result.samples.length).toBeGreaterThan(1);
      console.log('FULFILL TRANSPORT DIAGNOSTIC', JSON.stringify({loops:result.initial.completedLoops,error:result.error,resumed:result.resumed}));
    }
  });
}

test('native HTTP corrupt media is rejected, not mistaken for playback', async ({ page }) => {
  await fixture(page);
  // Byte transport control is independent of playback instrumentation.
  const full = await page.request.get('/api/plain/file');
  expect(full.status()).toBe(200); expect(await full.body()).toEqual(VIDEO);
  const range = await page.request.get('/api/plain/file', { headers: { Range: 'bytes=3-31' } });
  expect(range.status()).toBe(206); expect(await range.body()).toEqual(VIDEO.subarray(3,32));
  expect(range.headers()['content-range']).toBe(`bytes 3-31/${VIDEO.length}`);
  expect(range.headers()['content-length']).toBe('29');
  await page.goto('/plain-video');
  const result=await page.evaluate(async()=>{
    document.body.replaceChildren();const v=document.createElement('video');v.muted=true;document.body.append(v);window.__heroNativeProbe.observe(v);v.src='/api/plain/file?broken=1';
    const error=new Promise(resolve=>{v.addEventListener('error',()=>resolve(v.error?.code),{once:true});setTimeout(()=>resolve(null),4500);});
    v.play().catch(()=>{});return{error:await error,sample:window.__heroNativeProbe.observe(v)};
  });
  expect([3,4]).toContain(result.error);expect(result.sample.outputAdvances).toBe(0);
  expect(transports.get(page).responses.some(r=>r.broken&&r.status===200)).toBe(true);
});

test('decorative unavailable video retains visible poster and usable Models navigation', async ({ page }, testInfo) => {
  await openHome(page, 'en', { broken: true });
  await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(v => v.every(v => v.error))).toBe(true);
  const posters = page.locator(`${HERO_SLOTS} .latest-models-video-module__poster`);
  await expect(posters).toHaveCount(4);
  await expect.poll(() => posters.evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  expect(await page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(v => getComputedStyle(v).opacity === '0'))).toBe(true);
  for (const poster of await posters.all()) await expect(poster).toBeVisible();
  await testInfo.attach('visible-poster-fallback', { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('#hero [data-models-link]').first().click();
  await expect(page.locator('.models-overlay')).toBeVisible();
});

for (const locale of ['en', 'de']) {
  test(`${locale}: configured native media loops in every slot with the public range file contract`, { tag: '@homepage-extended' }, async ({ page }, testInfo) => {
    await openHome(page, locale);
    await expectPlaying(page);
    const result = await page.evaluate(() => window.__heroNativeProbe.waitForProgress({ loops: 2 }));
    await testInfo.attach('native-range-response-loop', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.samples.flat().every(video => video.duration === 1)).toBe(true);
    expect(result.passed, `${result.phase}: ${JSON.stringify(result.issues)}`).toBe(true);
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'native-loop-suspended', 200);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expectPlaying(page);
  });

  test(`${locale}: configured hero pauses offscreen and hidden, resumes existing media and respects an existing pause`, async ({ page }, testInfo) => {
    const state = await openHome(page, locale);
    await expectPlaying(page);
    await startContinuityProbe(page);
    // expectPlaying already proves each identity's new native output. Two
    // external currentTime snapshots can match after a legitimate loop.
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

  test(`${locale}: fallback freezes media and its staggered cycle while suspended`, { tag: '@homepage-extended' }, async ({ page }, testInfo) => {
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
    await page.evaluate(() => {
      window.__heroTurnCompletion = window.__heroNativeProbe.observePausedTransitions({ requireOutput: true });
      window.__setHeroDocumentHidden(false); // Observe and resume in the same task.
    });
    // This is the paused transition's resume, not an open-ended requirement
    // that every later fallback target finish loading in the same interval.
    const completion = await page.evaluate(() => window.__heroTurnCompletion);
    await testInfo.attach('resumed-transition-targets', { body: JSON.stringify(completion), contentType: 'application/json' });
    expect(completion.passed, `${completion.reason}: ${JSON.stringify(completion.targets)}`).toBe(true);
    await expectNativeResumeContinuity(page, testInfo, 'fallback-native-turn-resume');
    expect(state.errors).toEqual([]);
  });

  test(`${locale}: decorative fallback retains playable content while next media loads`, async ({ page }, testInfo) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = [];
    await page.route(/\/api\/gallery\/memvids\/playback-(2|7)\/v1\/file$/, async route => {
      pending.push(route.request().url());
      await gate;
      await route.continue(); // Native bytes still come from the real HTTP server.
    });
    try {
      await openHome(page, locale, { configured: false });
      await expectPlaying(page);
      const bottoms = page.locator(`${HERO_SLOTS}[data-latest-models-slot="bottom"]`);
      await expect.poll(() => bottoms.evaluateAll(slots => slots.map(s => s.dataset.previewPreparation))).toEqual(['loading', 'loading']);
      const kept = await bottoms.evaluateAll(slots => slots.map(s => ({ id: s.dataset.activeVideoId, src: s.querySelector('video').getAttribute('src') })));
      expect(kept.map(s => s.id).sort()).toEqual(['playback-1','playback-6']);
      await expectPlaying(page); // Each visible identity outputs while next bytes are held.
      expect(pending.length).toBeGreaterThanOrEqual(2);
      if (locale === 'en') {
        release();
        await expect.poll(() => bottoms.evaluateAll(slots => slots.map(s => s.dataset.activeVideoId).sort())).toEqual(['playback-2','playback-7']);
        await expectPlaying(page); // Adopted sources must supply their own output.
      } else {
        await page.evaluate(() => window.__setHeroDocumentHidden(true));
        await expectFrozen(page, testInfo, 'decorative-loading-suspended', 200);
        // Suspension cancels speculation; late responses cannot win after resume.
        release();
        await page.evaluate(() => window.__setHeroDocumentHidden(false));
        await expectPlaying(page);
        expect(await bottoms.evaluateAll(slots => slots.map(s => ({ id: s.dataset.activeVideoId, src: s.querySelector('video').getAttribute('src') })))).toEqual(kept);
      }
      await page.locator('#hero [data-models-link]').first().click();
      await expect(page.locator('.models-overlay')).toBeVisible();
    } finally { release(); }
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


test('native pause contract rejects ignored pause, transient source changes and stale resume proof', async ({ page }, testInfo) => {
  await openHome(page, 'en');
  await expectPlaying(page);
  const ignored = await page.evaluate(() => window.__heroNativeProbe.observeFrozen(200));
  await testInfo.attach('negative-ignored-pause', { body: JSON.stringify(ignored), contentType: 'application/json' });
  expect(ignored.passed).toBe(false); expect(ignored.issues).toContain('not-paused');
  await page.evaluate(() => window.__setHeroDocumentHidden(true));
  await expectFrozen(page, testInfo, 'positive-native-pause', 200);
  const changed = await page.evaluate(async () => {
    const v = document.querySelector('#hero video');
    const pending = window.__heroNativeProbe.observeFrozen(200);
    const src = v.getAttribute('src'); v.setAttribute('src', src + '?different=1'); v.setAttribute('src', src);
    return pending;
  });
  await testInfo.attach('negative-transient-source', { body: JSON.stringify(changed), contentType: 'application/json' });
  expect(changed.passed).toBe(false); expect(changed.issues).toContain('source-mutation');
  // Prior successful playing evidence cannot pass a fresh paused interval.
  const stale = await page.evaluate(() => window.__heroNativeProbe.waitForProgress({ timeout: 200 }));
  expect(stale.passed).toBe(false);
  await page.evaluate(() => window.__setHeroDocumentHidden(false));
  await expectPlaying(page); // Real native output after the invalidated source.
});
