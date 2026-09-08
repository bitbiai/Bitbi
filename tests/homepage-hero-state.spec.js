const { test, expect } = require('@playwright/test');
const { installHeroNativeProbe, everyActiveSlotProgressed, createProgressWindow } = require('./helpers/homepage-hero-native-probe');

const SLOTS = '#hero [data-latest-models-slot]';
const VIDEOS = `${SLOTS} video`;

test('probe only: every active slot needs its own native progress and identity', () => {
  const previous = ['left_top', 'left_bottom', 'right_top', 'right_bottom'].map((slot, index) => ({
    id: index + 1, slot, active: true, connected: true, src: `/fixture-${index}.mp4`,
    time: 0.2, frames: 3, paused: false, readyState: 4, error: null,
  }));
  const progressed = previous.map(video => ({ ...video, time: 0.4, frames: 6 }));
  expect(everyActiveSlotProgressed(previous, progressed)).toBe(true);
  expect(everyActiveSlotProgressed(previous, progressed.slice(1))).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...previous[0] }, ...progressed.slice(1)])).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...progressed[0], paused: true }, ...progressed.slice(1)])).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...progressed[0], id: 99 }, ...progressed.slice(1)])).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...progressed[0], slot: 'unknown_top' }, ...progressed.slice(1)])).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...progressed[0], error: 3 }, ...progressed.slice(1)])).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...previous[0], time: 0 }, ...progressed.slice(1)])).toBe(false);
  expect(everyActiveSlotProgressed(previous, [{ ...progressed[0], time: 0 }, ...progressed.slice(1)])).toBe(true);
  // A retired/outgoing face is not an active slot, but a newly incoming target
  // still needs progress from that exact video's own prior sample.
  const outgoing = { ...previous[0], active: false, role: 'outgoing', paused: true };
  expect(everyActiveSlotProgressed(previous, [...progressed, outgoing])).toBe(true);
  const incoming = { ...previous[0], id: 5, role: 'incoming', time: 0, frames: 0 };
  expect(everyActiveSlotProgressed([...previous, incoming], [incoming, ...progressed.slice(1), outgoing])).toBe(false);
  expect(everyActiveSlotProgressed([...previous, incoming], [{ ...incoming, time: 0.1, frames: 2 }, ...progressed.slice(1), outgoing])).toBe(true);
});

test('probe window retains asynchronous slot proof but rejects frozen, changed and resumed identities', () => {
  const initial=['left_top','left_bottom','right_top','right_bottom'].map((slot,id)=>({id,slot,src:`/${id}`,epoch:0,active:true,connected:true,paused:false,readyState:4,error:null,frames:1,outputAdvances:0,completedLoops:0}));
  const observe=createProgressWindow({loops:2});expect(observe(initial)).toBe(false);
  const current=structuredClone(initial);
  for(let i=0;i<4;i++) {
    current[i]={...current[i],outputAdvances:1,completedLoops:2};
    expect(observe(current)).toBe(i===3);
  }
  // No output from even one active slot must remain a failure.
  const frozen=createProgressWindow();frozen(initial);expect(frozen([initial[0],...current.slice(1)])).toBe(false);
  for(const patch of [{src:'/other'},{id:99},{epoch:1},{paused:true},{error:3},{readyState:0}]) {
    const w=createProgressWindow();w(initial);expect(w(current)).toBe(true);
    expect(w([{...current[0],...patch},...current.slice(1)])).toBe(false);
  }
  // Fresh invocation after resume cannot inherit the previous invocation's proof.
  expect(createProgressWindow()(current)).toBe(false);
});

test('browser progress window survives delayed transport but never reuses a changed or frozen slot', async ({ page }) => {
  // Instrument regression only: synthetic samples and real browser timers.
  // Native decoding is independently required by homepage-hero-playback.
  await installHeroNativeProbe(page);
  await page.goto('/plain-video');
  await page.evaluate(() => {
    const initial = ['left_top','left_bottom','right_top','right_bottom'].map((slot,id) => ({
      id, slot, src: `/${id}`, epoch: 0, active: true, connected: true,
      paused: false, readyState: 4, error: null, outputAdvances: 0, completedLoops: 0,
    }));
    let current = structuredClone(initial);
    const snapshots = [];
    window.__heroNativeProbe.sample = () => { snapshots.push(structuredClone(current)); return structuredClone(current); };
    window.__transportProof = window.__heroNativeProbe.waitForProgress({ timeout: 500 });
    // Each slot outputs at a different instant; a normal source transition then
    // retires two identities before the deliberately delayed caller reads back.
    [0,1,2,3].forEach(i => setTimeout(() => { current[i].outputAdvances++; }, 25 + i * 25));
    setTimeout(() => { current[0].src = '/next'; current[1].src = '/next-2'; }, 160);
    window.__transportSnapshots = snapshots;
    window.__transportInitial = initial;
    window.__transportCurrent = () => current;
  });
  // A browser timer models delayed protocol consumption, not playback success.
  const result = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
    return { proof: await window.__transportProof, before: window.__transportInitial, after: window.__transportCurrent() };
  });
  expect(result.proof.passed).toBe(true);
  const oldRoundTrips = createProgressWindow();
  expect(oldRoundTrips(result.before)).toBe(false);
  expect(oldRoundTrips(result.after)).toBe(false); // Old two-roundtrip observation loses that valid window.
  for (const fault of ['frozen', 'source', 'epoch', 'paused', 'missing']) {
    const rejected = await page.evaluate(async fault => {
      const current = structuredClone(window.__transportInitial);
      window.__heroNativeProbe.sample = () => structuredClone(current);
      const pending = window.__heroNativeProbe.waitForProgress({ timeout: 120 });
      setTimeout(() => {
        current.forEach((v,i) => { if (i !== 0 || fault !== 'frozen') v.outputAdvances++; });
        if (fault === 'source') current[0].src = '/unproved';
        if (fault === 'epoch') current[0].epoch++;
        if (fault === 'paused') current[0].paused = true;
        if (fault === 'missing') current.shift();
      }, 25);
      return pending;
    }, fault);
    expect(rejected.passed, fault).toBe(false);
  }
});

test('probe only: the appended target is distinguished from the outgoing face in both transition shapes', async ({ page }) => {
  await installHeroNativeProbe(page);
  await controlledHero(page);
  const roles = await page.evaluate(() => {
    const slot = document.querySelector('#hero [data-latest-models-slot]');
    const cube = slot.querySelector('.latest-models-video-module__cube');
    const incoming = cube.firstElementChild.cloneNode(true);
    const slotKey = window.__heroNativeProbe.sample()[0].slot;
    const read = () => window.__heroNativeProbe.sample().filter(video => video.slot === slotKey)
      .map(({ role, active }) => ({ role, active }));
    cube.append(incoming);
    incoming.classList.replace('latest-models-video-module__face--front', 'latest-models-video-module__face--right');
    slot.classList.add('is-turning');
    const normal = read();
    slot.classList.replace('is-turning', 'is-reduced-transition');
    incoming.classList.replace('latest-models-video-module__face--right', 'latest-models-video-module__face--front');
    const reduced = read();
    cube.firstElementChild.remove();
    slot.classList.remove('is-reduced-transition');
    return { normal, reduced, settled: read() };
  });
  expect(roles.normal).toEqual([{ role: 'outgoing', active: false }, { role: 'selected-target', active: true }]);
  expect(roles.reduced).toEqual(roles.normal);
  expect(roles.settled).toEqual([{ role: 'active', active: true }]);
});

async function controlledHero(page) {
  // This suite tests controller timing only. The separate playback suite uses
  // real media, decoding and CSS animations with no clock or player mocks.
  await page.clock.install({ time: new Date('2026-09-07T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-07T00:00:01Z'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    window.__heroHidden = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    const playing = new WeakSet();
    Object.defineProperties(HTMLMediaElement.prototype, {
      paused: { configurable: true, get() { return !playing.has(this); } },
      play: { configurable: true, value() { playing.add(this); return Promise.resolve(); } },
      pause: { configurable: true, value() { playing.delete(this); } },
    });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:3000') return route.abort();
    if (url.pathname === '/__hero-state-fixture') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <section id="hero" style="height:500px"><div class="hero__models-cta">
          ${['left', 'right'].map(side => `<div data-latest-models-video-module data-latest-models-video-module-side="${side}">
            <span data-latest-models-slot="top"></span><span data-latest-models-slot="bottom"></span></div>`).join('')}
        </div></section><script type="module">
          import { initLatestModelsVideoModule } from '/js/pages/index/latest-models-video-module.js';
          initLatestModelsVideoModule();
        </script></body></html>` });
    }
    if (url.pathname === '/api/homepage/hero-videos') {
      return route.fulfill({ json: { ok: true, data: { configured: false, slots: [] } } });
    }
    if (url.pathname === '/api/gallery/memvids') {
      return route.fulfill({ json: { ok: true, data: { items: Array.from({ length: 10 }, (_, index) => ({
        id: `state-${index}`, published_at: `2026-05-${String(20 - index).padStart(2, '0')}T00:00:00Z`,
        file: { url: `/api/gallery/memvids/state-${index}/v1/file` },
      })), has_more: false, next_cursor: null } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
  await page.goto('/__hero-state-fixture');
  await expect(page.locator(VIDEOS)).toHaveCount(4);
  await expect(page.locator('[data-video-module-state="ready"]')).toHaveCount(2);
}

async function rememberMedia(page) {
  await page.evaluate(selector => {
    window.__heroStateMedia = Array.from(document.querySelectorAll(selector));
    window.__heroStateSources = window.__heroStateMedia.map(video => video.getAttribute('src'));
  }, VIDEOS);
}

async function continuity(page) {
  return page.evaluate(selector => {
    const current = Array.from(document.querySelectorAll(selector));
    return {
      sameVideos: current.length === window.__heroStateMedia.length && current.every((video, i) => video === window.__heroStateMedia[i]),
      retained: window.__heroStateMedia.every(video => current.includes(video)),
      sameSources: window.__heroStateMedia.every((video, i) => video.getAttribute('src') === window.__heroStateSources[i]),
    };
  }, VIDEOS);
}

const unchanged = { sameVideos: true, retained: true, sameSources: true };
const cycles = page => page.locator(SLOTS).evaluateAll(slots => slots.map(slot => Number(slot.dataset.transitionCount)));

for (const elapsed of [100, 1999]) {
  test(`state only: fallback retains the ${2000 - elapsed}ms remaining cycle across suspension`, async ({ page }) => {
    await controlledHero(page);
    await page.evaluate(() => window.__heroHidden(false));
    await page.clock.runFor(elapsed);
    await rememberMedia(page);
    await page.evaluate(() => window.__heroHidden(true));
    await page.clock.runFor(10000);
    expect(await cycles(page)).toEqual([0, 0, 0, 0]);
    expect(await continuity(page)).toEqual(unchanged);
    expect(await page.locator(VIDEOS).evaluateAll(videos => videos.every(video => video.paused))).toBe(true);

    await page.evaluate(() => window.__heroHidden(false));
    expect(await continuity(page)).toEqual(unchanged);
    await page.clock.runFor(2000 - elapsed - 1);
    expect(await cycles(page)).toEqual([0, 0, 0, 0]);
    expect(await continuity(page)).toEqual(unchanged);
    await page.clock.runFor(1);
    expect(await cycles(page)).toEqual([0, 1, 0, 1]);
    await expect(page.locator(VIDEOS)).toHaveCount(6);
    // The original post-resume equality assertion becomes false at a legitimate
    // due transition: two incoming faces are added, old videos are not reset.
    expect(await continuity(page)).toEqual({ sameVideos: false, retained: true, sameSources: true });
    await page.clock.runFor(1040);
    await expect(page.locator(VIDEOS)).toHaveCount(4);
    expect(await cycles(page)).toEqual([0, 1, 0, 1]);
    await page.clock.runFor(959);
    expect(await cycles(page)).toEqual([0, 1, 0, 1]);
    await page.clock.runFor(1);
    expect(await cycles(page)).toEqual([1, 1, 1, 1]);
  });
}

test('state only: suspended transition retains both faces, remaining deadline and manual pause', async ({ page }) => {
  await controlledHero(page);
  await page.evaluate(() => window.__heroHidden(false));
  await page.clock.runFor(2400);
  await expect(page.locator(`${SLOTS}.is-turning`)).toHaveCount(2);
  await rememberMedia(page);
  await page.locator(VIDEOS).first().evaluate(video => video.pause());
  await page.evaluate(() => {
    window.__heroHidden(true);
    window.__heroTurningCubes = Array.from(document.querySelectorAll('#hero .is-turning.latest-models-video-module__cube'));
    window.__heroTurningCubes.forEach(cube => cube.dispatchEvent(new Event('animationend')));
  });
  await page.clock.runFor(10000);
  expect(await cycles(page)).toEqual([0, 1, 0, 1]);
  expect(await continuity(page)).toEqual(unchanged);
  expect(await page.locator(`${SLOTS}.is-turning > span`).evaluateAll(cubes => cubes.every(cube => cube.style.animationPlayState === 'paused'))).toBe(true);
  await page.evaluate(() => window.__heroHidden(false));
  expect(await continuity(page)).toEqual(unchanged);
  expect(await page.locator(VIDEOS).evaluateAll(videos => videos.map(video => video.paused))).toEqual([true, false, false, false, false, false]);
  await page.clock.runFor(639);
  await expect(page.locator(VIDEOS)).toHaveCount(6);
  await page.clock.runFor(1);
  await expect(page.locator(VIDEOS)).toHaveCount(4);
  await expect(page.locator(`${SLOTS}.is-turning`)).toHaveCount(0);
  await page.evaluate(() => window.__heroTurningCubes.forEach(cube => cube.dispatchEvent(new Event('animationend'))));
  expect(await cycles(page)).toEqual([0, 1, 0, 1]);
  await page.clock.runFor(960);
  expect(await cycles(page)).toEqual([1, 1, 1, 1]);
});

test('probe only: cached decode counts do not hide output; frozen frames and stale epochs never pass', async ({ page }) => {
  // Deliberately simulated metadata unit test of the actual observer, not a
  // native playback pass. The independent HTTP native control stays separate.
  await installHeroNativeProbe(page);
  await page.goto('/plain-video');
  const result = await page.evaluate(() => {
    const video = document.createElement('video');
    document.body.append(video);
    let next, time = 0, paused = false;
    Object.defineProperties(video, {
      currentTime: { get: () => time }, paused: { get: () => paused },
      seeking: { get: () => false }, readyState: { get: () => 4 },
    });
    video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 15 });
    video.requestVideoFrameCallback = callback => { next = callback; return 1; };
    const read = () => window.__heroNativeProbe.observe(video);
    const emit = value => { time = value; next(performance.now(), { mediaTime: value, presentedFrames: 15 }); return read().outputAdvances; };
    read(); emit(0.1);
    const baseline = read().outputAdvances;
    const frozen = emit(0.1);
    const progress = emit(0.2);
    paused = true; video.dispatchEvent(new Event('pause'));
    const pauseEpoch = read().epoch;
    emit(0.3); // pending callback from the retired epoch is discarded
    paused = false;
    const resumeBaseline = emit(0.4);
    const resumeProgress = emit(0.5);
    video.setAttribute('src', '/synthetic-other-source.mp4');
    const sourceEpoch = read().epoch;
    const sourceBaseline = emit(0.6); // callback registered for previous source
    const sourceFirst = emit(0.1);
    const sourceProgress = emit(0.2);
    return { baseline, frozen, progress, pauseEpoch, resumeBaseline, resumeProgress, sourceEpoch, sourceBaseline, sourceFirst, sourceProgress };
  });
  expect(result.frozen).toBe(result.baseline);
  expect(result.progress).toBe(result.baseline + 1);
  expect(result.resumeBaseline).toBe(result.progress);
  expect(result.resumeProgress).toBe(result.progress + 1);
  expect(result.pauseEpoch).toBeGreaterThan(0);
  expect(result.sourceEpoch).toBeGreaterThan(result.pauseEpoch);
  expect(result.sourceBaseline).toBe(result.resumeProgress);
  expect(result.sourceFirst).toBe(result.sourceBaseline);
  expect(result.sourceProgress).toBe(result.sourceFirst + 1);
});
