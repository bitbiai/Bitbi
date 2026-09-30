const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installHeroNativeProbe } = require('./helpers/homepage-hero-native-probe');
const { readHeroFallback, expectHeroFallback, expectModelsUsable, expectDecorativeUsable,
  observeDecorative, observeDecorativeProgress } = require('./helpers/homepage-decorative-media.cjs');

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

async function fixture(page, { configured = true, initiallyHidden = false, transport = 'http', broken = false, loadingFixture = false } = {}) {
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
        file: { url: `/api/gallery/memvids/playback-${index}/v1/file${loadingFixture ? "?loading-fixture=1" : ""}` },
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
  await expectDecorativeUsable(page);
  return state;
}

async function observePlaying(page, resume = null, captureTargets = false) {
  return observeDecorativeProgress(page, test.info(), { resume, captureTargets });
}

async function observeDecorativeCondition(page, testInfo, check, read) {
  return observeDecorative(page, testInfo, check, async timeout => {
    const start = performance.now();
    let observed = await read();
    while (!observed.passed && performance.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 40));
      observed = await read();
    }
    const elapsed = performance.now() - start;
    return { passed: observed.passed && elapsed <= timeout, phase: check, observed, elapsed, timeout };
  });
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

async function suspendAtNativeTurn(page, testInfo) {
  return observeDecorative(page, testInfo, 'turn-acquisition', timeout => page.evaluate(({ selector, timeout }) => new Promise(resolve => {
    const start = performance.now();
    let timer;
    const observer = new MutationObserver(inspect);
    const finish = passed => {
      observer.disconnect(); clearTimeout(timer);
      const elapsed = performance.now() - start;
      resolve({ passed: passed && elapsed <= timeout, phase: 'turn-acquisition', elapsed, timeout,
        observed: { turning: !!document.querySelector(`${selector}.is-turning`) } });
    };
    function inspect() {
      if (!document.querySelector(`${selector}.is-turning`)) return;
      // Freeze the exact turn in the same DOM update. A missing decorative
      // turn is a quality observation; the pause/nav checks still run below.
      window.__setHeroDocumentHidden(true);
      finish(true);
    }
    observer.observe(document.querySelector('#hero'), { attributes: true, attributeFilter: ['class'], subtree: true });
    timer = setTimeout(() => finish(false), timeout);
    inspect();
  }), { selector: HERO_SLOTS, timeout }), { max: 3000 });
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
  test(`${locale}: configured native media loops in every slot with the public range file contract`, { tag: ['@homepage-extended', '@decorative-playback'] }, async ({ page }, testInfo) => {
    await openHome(page, locale);
    await observePlaying(page);
    await observeDecorativeProgress(page, testInfo, { loops: 2, check: 'range-loop' });
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'native-loop-suspended', 200);
    await observePlaying(page, 'visible');
    await expectDecorativeUsable(page);
  });

  test(`${locale}: configured hero pauses offscreen and hidden, resumes existing media and respects an existing pause`, { tag: '@decorative-playback' }, async ({ page }, testInfo) => {
    const state = await openHome(page, locale);
    await observePlaying(page);
    await startContinuityProbe(page);
    // Record quality independently; source/DOM continuity and suspension below
    // remain required even when no fresh decorative frames were observed.
    await scrollHeroOffscreen(page);
    await expectFrozen(page, testInfo, 'offscreen-native-playback');
    await observePlaying(page, 'onscreen');
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
    await observePlaying(page, 'visible');
    await expectContinuity(page);

    await page.locator(HERO_VIDEOS).first().evaluate(video => video.pause());
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'hidden-after-existing-pause', 200);
    await page.evaluate(() => window.__setHeroDocumentHidden(false));
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.map(video => video.paused)))
      .toEqual([true, false, false, false]);
    await expectContinuity(page);
    expect(state.errors).toEqual([]);
    await expectDecorativeUsable(page);
  });

  test(`${locale}: fallback freezes media and its staggered cycle while suspended`, { tag: ['@homepage-extended', '@decorative-playback'] }, async ({ page }, testInfo) => {
    const state = await openHome(page, locale, { configured: false });
    // This phase observes output from its four captured videos. A lawful cycle
    // can select a successor while the original face still visibly plays.
    // Current-target loading and loop/seek behavior have independent cases.
    await observePlaying(page, null, true);
    await scrollHeroOffscreen(page);
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
    // The offscreen observer is asynchronous. The frozen interval begins at
    // confirmed suspension, not at a driver sample that may precede a due turn.
    await startContinuityProbe(page);
    const cyclesBefore = await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount));
    await expectFrozen(page, testInfo, 'fallback-offscreen-native-playback', 2400);
    expect(await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount))).toEqual(cyclesBefore);
    await expectContinuity(page);
    await observePlaying(page, 'onscreen', true);
    await expectNativeResumeContinuity(page, testInfo, 'fallback-native-resume');

    // Suspension during an actual cube turn retains both faces and resumes it.
    const turn = await suspendAtNativeTurn(page, testInfo);
    if (!turn.passed) await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await startContinuityProbe(page);
    const duringTurn = await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount));
    await expectFrozen(page, testInfo, 'fallback-hidden-during-transition', 1250);
    expect(await page.locator(HERO_SLOTS).evaluateAll(slots => slots.map(slot => slot.dataset.transitionCount))).toEqual(duringTurn);
    await expectContinuity(page);
    if (turn.passed) {
      await observeDecorative(page, testInfo, 'paused-transition', timeout => page.evaluate(timeout => {
        const completion = window.__heroNativeProbe.observePausedTransitions({ requireOutput: true, timeout });
        window.__setHeroDocumentHidden(false);
        return completion;
      }, timeout), { max: 2000, onBudget: () => page.evaluate(() => window.__setHeroDocumentHidden(false)) });
    } else {
      await observePlaying(page, 'visible', true);
    }
    await expectNativeResumeContinuity(page, testInfo, 'fallback-native-turn-resume');
    expect(state.errors).toEqual([]);
    await expectDecorativeUsable(page);
  });

  test(`${locale}: decorative fallback retains playable content while next media loads`, { tag: '@decorative-playback' }, async ({ page }, testInfo) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = [];
    await page.route(/\/api\/gallery\/memvids\/playback-(2|7)\/v1\/file\?loading-fixture=1$/, async route => {
      pending.push(route.request().url());
      await gate;
      await route.continue(); // Native bytes still come from the real HTTP server.
    });
    try {
      // A 12-second, stream-copied version of the same native clip separates
      // this loading contract from one-second loop-seek scheduling. Short-clip
      // loop checks and the old-controller readiness countercontrol remain.
      await openHome(page, locale, { configured: false, loadingFixture: true });
      await observePlaying(page);
      const bottoms = page.locator(`${HERO_SLOTS}[data-latest-models-slot="bottom"]`);
      // Each real successor request must occur; unrelated slots need not enter
      // speculation in the same driver sample. No request is not an adoption pass.
      await observeDecorativeCondition(page, testInfo, 'next-preview-requests', () => ({
        passed: ['playback-2', 'playback-7'].every(id => pending.some(url => url.includes(`/${id}/`))),
        requests: pending.slice(),
      }));
      const kept = await bottoms.evaluateAll(slots => slots.map(s => ({ id: s.dataset.activeVideoId, src: s.querySelector('video').getAttribute('src') })));
      expect(kept.map(s => s.id).sort()).toEqual(['playback-1','playback-6']);
      await observePlaying(page); // Observe retained identities while next bytes are held.
      if (locale === 'en') {
        release();
        await observeDecorativeCondition(page, testInfo, 'next-preview-adoption', async () => {
          const targets = await bottoms.evaluateAll(slots => slots.map(s => s.dataset.activeVideoId).sort());
          return { passed: JSON.stringify(targets) === JSON.stringify(['playback-2', 'playback-7']), targets };
        });
        await observePlaying(page); // Keep adopted-source output as explicit quality evidence.
      } else {
        await page.evaluate(() => window.__setHeroDocumentHidden(true));
        await expectFrozen(page, testInfo, 'decorative-loading-suspended', 200);
        // Suspension cancels speculation; late responses cannot win after resume.
        release();
        const retained = await page.evaluate(() => window.__heroNativeProbe.sample().filter(v => v.active && v.slot.endsWith('_bottom')));
        const resumed = await observeDecorative(page, testInfo, 'cancelled-preparation-output', timeout => page.evaluate(timeout => {
          window.__setHeroDocumentHidden(false);
          // Observe current output in the same browser task. Upper slots may
          // legally advance; only the two cancelled preparations must retain
          // their original identities. The native probe still requires fresh
          // submitted-frame pairs for all four current slots within its deadline.
          return window.__heroNativeProbe.waitForProgress({ timeout });
        }, timeout), { onBudget: () => page.evaluate(() => window.__setHeroDocumentHidden(false)) });
        expect(retained.map(v => v.slot).sort()).toEqual(['left_bottom','right_bottom']);
        for (const sample of resumed.samples || []) for (const before of retained) {
          const current = sample.find(v => v.active && v.slot === before.slot);
          expect(current, `Cancelled preparation retained ${before.slot}`).toMatchObject({ id: before.id, src: before.src, epoch: before.epoch, connected: true });
        }
        expect(await bottoms.evaluateAll(slots => slots.map(s => ({ id: s.dataset.activeVideoId, src: s.querySelector('video').getAttribute('src') })))).toEqual(kept);
      }
      await expectDecorativeUsable(page);
    } finally { release(); }
  });

  test(`${locale}: hidden initialization and bfcache restore preserve media; ordinary pagehide cleans up`, { tag: '@decorative-playback' }, async ({ page }, testInfo) => {
    const state = await openHome(page, locale, { initiallyHidden: true });
    await startContinuityProbe(page);
    await expectFrozen(page, testInfo, 'initial-hidden-native-playback', 200);
    await observePlaying(page, 'visible');
    await expectContinuity(page);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await expectFrozen(page, testInfo, `bfcache-hidden-${cycle}`, 200);
      await observePlaying(page, 'pageshow');
      await expectContinuity(page);
    }
    // A first resumed frame does not certify subsequent looping. Keep the
    // post-bfcache seek/output observation separate and bounded.
    await observeDecorativeProgress(page, testInfo, { loops: 1, check: 'post-bfcache-loop' });
    await expectContinuity(page);
    // Listener reattachment is observable after the bfcache round trips.
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    await expectFrozen(page, testInfo, 'hidden-after-bfcache', 200);
    await observePlaying(page, 'visible');
    // Keep a subsequent stuck loop/seek visible as its own quality warning,
    // including this final visibility cycle. Cleanup does not depend on it.
    await observeDecorativeProgress(page, testInfo, { loops: 1, check: 'post-visibility-loop' });
    await expectDecorativeUsable(page);
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

  test(`${locale}: phone and tablet breakpoints retain existing policy with reduced motion`, { tag: '@decorative-playback' }, async ({ page }, testInfo) => {
    await fixture(page, { configured: false });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(locale === 'de' ? '/de/' : '/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.auth-modal__overlay')).toBeAttached();
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(0);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(4);
    await expectDecorativeUsable(page);
    await observePlaying(page);
    await expect(page.locator(`${HERO_SLOTS}.is-turning`)).toHaveCount(0);
    await scrollHeroOffscreen(page);
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
    await startContinuityProbe(page);
    await expectFrozen(page, testInfo, 'tablet-reduced-motion-offscreen');
    await observePlaying(page, 'onscreen');
    await expectNativeResumeContinuity(page, testInfo, 'reduced-motion-native-resume');
    await page.setViewportSize({ width: 820, height: 650 });
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(HERO_VIDEOS)).toHaveCount(4);
    await observePlaying(page);
    await expectDecorativeUsable(page);
  });

  test(`${locale}: decorative frozen media warns while fallback and Models remain required`, { tag: '@decorative-playback' }, async ({ page }, testInfo) => {
    await openHome(page, locale);
    // Genuine native pause is a deterministic frozen-output control. No clock,
    // decoder, frame callback or successful play result is manufactured.
    await page.locator(HERO_VIDEOS).evaluateAll(videos => videos.forEach(video => video.pause()));
    await expect.poll(() => page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
    const frozenBaseline = await page.evaluate(() => window.__heroNativeProbe.sample());
    const frozen = await observeDecorativeProgress(page, testInfo, { check: 'frozen-control', control: true });
    expect(frozen.passed).toBe(false);
    expect(frozen.phase).toBe('play-or-resume');
    expect(frozen.ownOutputObserved).toBe(false);
    expect(frozenBaseline).toHaveLength(4);
    expect(frozen.samples.flat().every(video => {
      const before = frozenBaseline.find(item => item.id === video.id);
      return before && video.paused && video.src === before.src && video.outputAdvances === before.outputAdvances;
    })).toBe(true);
    // Deterministically finish a real short frozen observation without calling
    // its supplied action. Only observer orchestration is controlled here;
    // native media and the returned failed samples remain untouched.
    await page.evaluate(() => {
      window.__setHeroDocumentHidden(true);
      const probe = window.__heroNativeProbe;
      window.__originalHeroProgress = probe.waitForProgress;
      probe.waitForProgress = options => window.__originalHeroProgress({ ...options, action: null, timeout: 1 });
    });
    try {
      const early = await observeDecorativeProgress(page, testInfo, { resume: 'visible', control: true });
      expect(early.passed).toBe(false);
      expect(early.actionAt).toBeNull();
      expect(early.actionAfterObservation).toBe(true);
      expect(await page.evaluate(() => document.hidden)).toBe(false);
    } finally {
      await page.evaluate(() => { window.__heroNativeProbe.waitForProgress = window.__originalHeroProgress; });
    }
    // Consume the remaining optional budget with another real frozen window.
    // The next functional visibility action must still run, without inventing
    // a successful playback observation when no observation time remains.
    await observeDecorativeProgress(page, testInfo, { check: 'frozen-control', control: true });
    await page.evaluate(() => window.__setHeroDocumentHidden(true));
    const exhausted = await observeDecorativeProgress(page, testInfo, { resume: 'visible', control: true });
    expect(exhausted).toMatchObject({ passed: false, phase: 'observation-budget', reason: 'quality-budget-exhausted' });
    expect(await page.evaluate(() => document.hidden)).toBe(false);
    expect(await page.locator(HERO_VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);
    await expectDecorativeUsable(page);

    // Both permitted visual paths are hidden. A poster node or decoded frame
    // alone cannot turn this genuinely invisible fallback into acceptance.
    await page.locator(`${HERO_SLOTS} video, ${HERO_SLOTS} img`).evaluateAll(media => media.forEach(item => item.style.visibility = 'hidden'));
    const hidden = await readHeroFallback(page);
    expect(hidden.passed).toBe(false);
    await expect(expectHeroFallback(page)).rejects.toThrow('visible decoded poster or still');
    await page.locator(`${HERO_SLOTS} video, ${HERO_SLOTS} img`).evaluateAll(media => media.forEach(item => item.style.removeProperty('visibility')));
    await expectHeroFallback(page);

    // Cover valid media with an opaque, non-interactive layer: DOM visibility
    // and decoded pixels still exist, but none is exposed to the user.
    await page.locator(HERO_SLOTS).evaluateAll(slots => slots.forEach(slot => {
      const cover = document.createElement('span'); cover.dataset.testHeroCover = '';
      cover.style.cssText = 'position:absolute;inset:0;background:#000;z-index:999;pointer-events:none';
      slot.append(cover);
    }));
    const covered = await readHeroFallback(page);
    expect(covered.passed).toBe(false);
    await page.locator('[data-test-hero-cover]').evaluateAll(covers => covers.forEach(cover => cover.remove()));
    await expectHeroFallback(page);

    await page.locator('#hero [data-models-link]').first().evaluate(trigger => {
      window.__blockModelsControl = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      trigger.addEventListener('click', window.__blockModelsControl, true);
    });
    await expect(expectModelsUsable(page)).rejects.toThrow();
    await page.locator('#hero [data-models-link]').first().evaluate(trigger => trigger.removeEventListener('click', window.__blockModelsControl, true));
    await expectDecorativeUsable(page);
    await testInfo.attach('decorative-functional-countercontrols', {
      body: JSON.stringify({ frozenWarning: true, hiddenFallbackRejected: !hidden.passed,
        coveredFallbackRejected: !covered.passed, brokenModelsRejected: true, recoveredModels: true,
        budgetExhaustionStillResumesVisibility: true, earlyObservationStillResumesVisibility: true }),
      contentType: 'application/json',
    });
  });
}


test('native pause contract rejects ignored pause, transient source changes and stale resume proof', { tag: '@decorative-playback' }, async ({ page }, testInfo) => {
  await openHome(page, 'en');
  await observePlaying(page);
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
  await observePlaying(page, 'visible'); // Observe output after the invalidated source.
  await expectDecorativeUsable(page);
});
