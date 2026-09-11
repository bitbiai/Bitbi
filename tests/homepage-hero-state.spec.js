const { test, expect } = require('@playwright/test');
const { installHeroNativeProbe, createProgressWindow } = require('./helpers/homepage-hero-native-probe');

const SLOTS = '#hero [data-latest-models-slot]';
const VIDEOS = `${SLOTS} video`;

test('probe replay: recorded stalled fourth slot stays red; seek needs fresh output in every identity', () => {
  const recorded = require('./fixtures/media/hero-stalled-slot.json');
  const observe = createProgressWindow();
  for (const row of recorded.samples) expect(observe(row)).toBe(false);
  expect(observe.issues()).toContainEqual(expect.objectContaining({slot:'right_bottom',condition:'seek-in-progress'}));
  const start = recorded.samples[0].map(v=>({...v,seeking:false,outputAdvances:0,completedLoops:0}));
  const good = start.map(v=>({...v,time:0.4,outputAdvances:1}));
  const seeking = good.map((v,i)=>i===3?{...v,time:0,seeking:true}:v);
  const seeked = seeking.map(v=>({...v,seeking:false}));
  const fresh = seeked.map((v,i)=>i===3?{...v,time:0.1,outputAdvances:2}:v);
  const phase=createProgressWindow();expect(phase(start)).toBe(false);expect(phase(good)).toBe(true);
  expect(phase(seeking)).toBe(false);expect(phase(seeked)).toBe(false);expect(phase(fresh)).toBe(true);
  // Old phase proof and three healthy neighbours cannot cover a blocked seek.
  expect(createProgressWindow()(fresh)).toBe(false);
  for(const fault of [{seeking:true},{error:3},{src:'/retired'},{epoch:99},{id:99}]) {
    const window=createProgressWindow();window(start);window(seeking);
    expect(window(fresh.map((v,i)=>i===3?{...v,...fault}:v))).toBe(false);
  }
});

test('probe replay: bfcache seek invalidation reports the effective deadline boundary without forgiving it', () => {
  const recorded = require('./fixtures/media/hero-bfcache-seek-window.json');
  const observe = createProgressWindow();
  for (const [index,row] of recorded.samples.entries()) {
    expect(observe(row)).toBe(false);
    if (index < 11) expect(observe.issues()).toContainEqual(expect.objectContaining({slot:'left_top',condition:'seek-in-progress'}));
  }
  expect(observe.issues()).toEqual([expect.objectContaining({slot:'right_bottom',beforeOutput:9,
    effectiveOutputBaseline:20,seekBaseline:20,output:20,progress:false,everProgress:true,
    lastInvalidation:{index:12,at:null,reason:'seeking'},observedIndex:14,condition:'no-new-output'})]);
  expect(observe.diagnostics().find(v=>v.slot==='left_top')).toMatchObject({
    progress:true,output:7,effectiveOutputBaseline:5,lastInvalidation:{index:11,at:null,reason:'seeking'},
  });
  const last = recorded.samples.at(-1);
  const subsequent = last.map(v=>({...v,outputAdvances:v.outputAdvances+1}));
  // Hypothetical subsequent output tests the contract; it never recertifies the
  // expired original native interval. A new interval needs its own evidence.
  expect(observe(subsequent)).toBe(true);
  expect(createProgressWindow()(subsequent)).toBe(false);
  for (const fault of [{seeking:true},{paused:true},{src:'/other'},{epoch:2},{id:99},{error:3},{}]) {
    const probe=createProgressWindow();recorded.samples.forEach(row=>probe(row));
    const changed=last.map(v=>v.slot==='right_bottom'?{...v,...fault}:v);
    expect(probe(changed)).toBe(false);
  }
});

test('probe only: every active slot needs its own native progress and identity', () => {
  // Exercise the actual browser progress window, not the retired frame-count
  // surrogate. Decoder statistics alone cannot prove new visible output.
  const progressedBetween = (before, after) => { const window = createProgressWindow(); window(before); return window(after); };
  const previous = ['left_top', 'left_bottom', 'right_top', 'right_bottom'].map((slot, index) => ({
    id: index + 1, slot, active: true, connected: true, src: `/fixture-${index}.mp4`,
    time: 0.2, frames: 3, outputAdvances: 0, paused: false, readyState: 4, error: null,
  }));
  const progressed = previous.map(video => ({ ...video, time: 0.4, frames: 6, outputAdvances: 1 }));
  expect(progressedBetween(previous, progressed)).toBe(true);
  expect(progressedBetween(previous, progressed.map((v,i)=>({...v,time:previous[i].time})))).toBe(true); // loops may return to the same position
  expect(progressedBetween(previous, previous)).toBe(false); // equal position without output remains frozen
  expect(progressedBetween(previous, previous.map(video => ({ ...video, frames: 6 })))).toBe(false);
  expect(progressedBetween(previous, progressed.slice(1))).toBe(false);
  expect(progressedBetween(previous, [{ ...previous[0] }, ...progressed.slice(1)])).toBe(false);
  expect(progressedBetween(previous, [{ ...progressed[0], paused: true }, ...progressed.slice(1)])).toBe(false);
  expect(progressedBetween(previous, [{ ...progressed[0], id: 99 }, ...progressed.slice(1)])).toBe(false);
  expect(progressedBetween(previous, [{ ...progressed[0], slot: 'unknown_top' }, ...progressed.slice(1)])).toBe(false);
  expect(progressedBetween(previous, [{ ...progressed[0], error: 3 }, ...progressed.slice(1)])).toBe(false);
  expect(progressedBetween(previous, [{ ...previous[0], time: 0 }, ...progressed.slice(1)])).toBe(false);
  expect(progressedBetween(previous, [{ ...progressed[0], time: 0 }, ...progressed.slice(1)])).toBe(true);
  // A retired/outgoing face is not an active slot, but a newly incoming target
  // still needs progress from that exact video's own prior sample.
  const outgoing = { ...previous[0], active: false, role: 'outgoing', paused: true };
  expect(progressedBetween(previous, [...progressed, outgoing])).toBe(true);
  const incoming = { ...previous[0], id: 5, role: 'incoming', time: 0, frames: 0 };
  expect(progressedBetween([...previous, incoming], [incoming, ...progressed.slice(1), outgoing])).toBe(false);
  // A newly active identity first establishes its own baseline. Only its
  // subsequent output may pass; progress while it was inactive is not reused.
  const incomingWindow = createProgressWindow();
  expect(incomingWindow([incoming, ...previous.slice(1), outgoing])).toBe(false);
  expect(incomingWindow([{ ...incoming, time: 0.1, outputAdvances: 1 }, ...progressed.slice(1), outgoing])).toBe(true);
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
  expect(result.proof.deadlineAt - result.proof.startedAt).toBe(500);
  expect(result.proof.decisions).toHaveLength(result.proof.samples.length);
  expect(result.proof.decisions.length).toBeLessThanOrEqual(60);
  for (const decision of result.proof.decisions) {
    expect(decision.at).toBeLessThanOrEqual(decision.sampledAt);
    expect(decision.sampledAt).toBeLessThanOrEqual(decision.evaluatedAt);
    expect(decision.slots).toHaveLength(4);
    expect(decision.slots[0].lastInvalidation).toMatchObject({index:1,reason:'initial'});
  }
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
    window.__readyNewMedia = true;
    window.__controlledVideos = [];
    const create = document.createElement.bind(document);
    document.createElement = (...args) => {
      const element = create(...args);
      if (args[0] === 'video') {
        window.__controlledVideos.push(element);
        element.__ready = window.__readyNewMedia;
      }
      return element;
    };
    Object.defineProperties(HTMLMediaElement.prototype, {
      readyState: { configurable: true, get() { return this.__ready ? 4 : 0; } },
      paused: { configurable: true, get() { return !playing.has(this); } },
      play: { configurable: true, value() { playing.add(this); this.dispatchEvent(new Event('playing')); return Promise.resolve(); } },
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
        poster: { url: `/api/gallery/memvids/state-${index}/v1/poster` },
      })), has_more: false, next_cursor: null } } });
    }
    if (url.pathname.endsWith('/poster')) return route.fulfill({ contentType: 'image/jpeg', body: require('fs').readFileSync(require('path').join(__dirname, 'fixtures/media/favorite-thumb.jpg')) });
    if (url.pathname.endsWith('/file')) return route.fulfill({ contentType: 'video/mp4', body: require('fs').readFileSync(require('path').join(__dirname, 'fixtures/media/test-video.mp4')) });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
  await page.goto('/__hero-state-fixture');
  await expect(page.locator(VIDEOS)).toHaveCount(4);
  await expect(page.locator('[data-video-module-state="ready"]')).toHaveCount(2);
}

test('preview readiness: slow, failed and retired next sources retain the current face; valid source commits once', async ({ page }) => {
  await controlledHero(page);
  await page.evaluate(() => { window.__heroHidden(false); window.__readyNewMedia = false; });
  await rememberMedia(page);
  await page.clock.runFor(2100);
  expect(await cycles(page)).toEqual([0,0,0,0]);
  expect(await continuity(page)).toEqual(unchanged);
  expect(await page.evaluate(() => window.__controlledVideos.length)).toBe(6); // one speculative source per due slot
  // Release one real controller input, fail its neighbour; these are state
  // controls, not a native playback claim.
  await page.evaluate(() => {
    const [valid, failed] = window.__controlledVideos.slice(4);
    valid.__ready = true; valid.dispatchEvent(new Event('loadeddata'));
    failed.dispatchEvent(new Event('error'));
    window.__released = valid; window.__retired = failed;
  });
  await page.clock.runFor(1100);
  expect(await cycles(page)).toEqual([0,1,0,0]);
  expect(await page.evaluate(() => window.__released.isConnected)).toBe(true);
  expect(await page.evaluate(() => window.__retired.hasAttribute('src'))).toBe(false);
  expect(await page.evaluate(() => window.__retired.parentElement.querySelector('img').hasAttribute('src'))).toBe(false);
  // A stale successful callback after failure cannot replace the held source.
  await page.evaluate(() => { window.__retired.__ready = true; window.__retired.dispatchEvent(new Event('loadeddata')); });
  expect(await cycles(page)).toEqual([0,1,0,0]);
  await page.clock.runFor(20000); // 4s cycle + 8s preparation after settlement
  expect(await page.locator(`${SLOTS}[data-preview-preparation="held"]`).count()).toBe(4);
  const count = await page.evaluate(() => window.__controlledVideos.length);
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.__controlledVideos.length)).toBe(count);
  await expect(page.locator(VIDEOS)).toHaveCount(4);
  // Pending work at a visibility change is abandoned without changing the
  // current source. A late callback cannot reactivate an offscreen slot.
  await page.reload();
  await expect(page.locator(VIDEOS)).toHaveCount(4);
  await page.evaluate(() => { window.__heroHidden(false); window.__readyNewMedia = false; });
  await page.clock.runFor(2100);
  await rememberMedia(page);
  await page.evaluate(() => {
    window.__pendingBeforeHide = window.__controlledVideos.slice(4);
    window.__heroHidden(true);
    window.__pendingBeforeHide.forEach(v => { v.__ready=true; v.dispatchEvent(new Event('loadeddata')); });
  });
  expect(await continuity(page)).toEqual(unchanged);
  expect(await page.locator(VIDEOS).evaluateAll(v => v.every(v => v.paused))).toBe(true);
  await page.evaluate(() => window.__heroHidden(false));
  expect(await continuity(page)).toEqual(unchanged);
});

test('preview readiness respects a manual pause made while the next source is preparing', async ({ page }) => {
  await controlledHero(page);
  await page.evaluate(() => { window.__heroHidden(false); window.__readyNewMedia = false; });
  await page.clock.runFor(2100);
  await rememberMedia(page);
  await page.locator(`${SLOTS}[data-latest-models-slot="bottom"] video`).first().evaluate(v => v.pause());
  await page.evaluate(() => { const next=window.__controlledVideos[4]; next.__ready=true; next.dispatchEvent(new Event('loadeddata')); });
  expect(await cycles(page)).toEqual([0,0,0,0]);
  expect(await continuity(page)).toEqual(unchanged);
  expect(await page.locator(`${SLOTS}[data-latest-models-slot="bottom"]`).first().getAttribute('data-preview-preparation')).toBe('held');
});

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
  test(`state only: fallback retains the ${2000 - elapsed}ms remaining cycle across suspension`, { tag: '@homepage-extended' }, async ({ page }) => {
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

test('state only: suspended transition retains both faces, remaining deadline and manual pause', { tag: '@homepage-extended' }, async ({ page }) => {
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
  expect(await cycles(page)).toEqual([0, 1, 1, 1]); // Deliberately paused left-top content is not replaced.
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
    // Decoder/layout inspection must not burden the output hot path. Explicit
    // final diagnostics may read these APIs separately from progress evidence.
    video.getVideoPlaybackQuality = () => { throw new Error('unexpected hot-path decoder query'); };
    video.getBoundingClientRect = () => { throw new Error('unexpected hot-path layout flush'); };
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

test('probe only: paused transition proof rejects foreign targets and survives later cycles', async ({ page }, testInfo) => {
  await installHeroNativeProbe(page);
  await page.goto('/plain-video');
  // DOM/observer countercontrols only. Real controller/CSS/video completion is
  // required separately by both EN/DE native fallback playback scenarios.
  const results = await page.evaluate(async () => {
    const results = [];
    const mount = () => {
      document.body.replaceChildren();
      const hero = document.createElement('section'); hero.id = 'hero';
      const module = document.createElement('div'); module.dataset.latestModelsVideoModule = '';
      module.dataset.latestModelsVideoModuleSide = 'left'; hero.append(module); document.body.append(hero);
      const slot = document.createElement('span'); module.append(slot);
      slot.dataset.latestModelsSlot = 'top'; slot.className = 'is-turning';
      Object.assign(slot.dataset, { transitionCount: '2', activeVideoId: 'target', activeIndex: '1' });
      const cube = document.createElement('span'); cube.className = 'latest-models-video-module__cube is-turning';
      cube.style.animationPlayState = 'paused'; slot.append(cube);
      const outgoing = document.createElement('span'); outgoing.className = 'latest-models-video-module__face--front';
      const face = document.createElement('span'); face.className = 'latest-models-video-module__face--right';
      const video = document.createElement('video'); video.className = 'latest-models-video-module__video';
      // No fake frame/time/play event. This source is never played by the unit.
      video.preload = 'none'; video.src = '/synthetic-transition-target.mp4'; face.append(video); cube.append(outgoing, face);
      const settle = (target = face) => {
        const next = document.createElement('span'); next.className = 'latest-models-video-module__cube';
        target.className = 'latest-models-video-module__face--front'; next.append(target);
        slot.replaceChildren(next); slot.classList.remove('is-turning');
      };
      return { slot, cube, face, video, settle };
    };
    for (const mode of ['empty', 'missing', 'hung', 'wrong', 'removed', 'source', 'foreign-number', 'foreign-slot', 'previous', 'completed-then-next', 'resume-no-output', 'resume-fresh-then-next', 'resume-old-epoch']) {
      const t = mount();
      if (mode === 'empty') t.slot.remove();
      if (mode === 'missing') t.face.remove();
      if (mode === 'previous') t.settle();
      const requireOutput = mode.startsWith('resume-');
      let emit, resume;
      if(requireOutput) {
        // Explicit observer unit only: feed controlled metadata to the existing
        // probe. The unchanged native HTTP EN/DE cases provide real decoding.
        let callback, paused=true;
        Object.defineProperties(t.video, { paused:{get:()=>paused}, seeking:{get:()=>false}, readyState:{get:()=>4} });
        t.video.requestVideoFrameCallback = next => { callback=next; return 1; };
        resume = () => { paused=false; };
        emit = time => { paused=false; callback(performance.now(), {mediaTime:time,presentedFrames:1}); };
      }
      const proof = window.__heroNativeProbe.observePausedTransitions({ timeout: 120, requireOutput });
      if(requireOutput) {
        t.settle(); resume();
        if(mode==='resume-old-epoch') t.video.dispatchEvent(new Event('pause'));
        if(mode!=='resume-no-output') { emit(0.1);emit(0.2); }
      }
      if (mode === 'wrong') t.settle(t.face.cloneNode(true));
      if (mode === 'removed') t.face.remove();
      if (mode === 'source') { t.video.src = '/synthetic-wrong-source.mp4'; t.settle(); }
      if (mode === 'foreign-number') { t.slot.dataset.transitionCount = '3'; t.settle(); }
      if (mode === 'foreign-slot') {
        const other = t.slot.cloneNode(true); other.dataset.latestModelsSlot = 'bottom';
        t.slot.parentNode.append(other); other.classList.remove('is-turning'); other.firstElementChild.classList.remove('is-turning');
      }
      if (mode === 'completed-then-next' || mode === 'resume-fresh-then-next') {
        t.settle();
        await Promise.resolve(); // Allow the exact settled state to be observed.
        const next = document.createElement('span'); next.className = 'latest-models-video-module__cube is-turning';
        const later = t.face.cloneNode(true); later.className = 'latest-models-video-module__face--right';
        later.querySelector('video').src = '/synthetic-later-target.mp4'; next.append(t.face, later);
        t.slot.replaceChildren(next); t.slot.classList.add('is-turning');
        t.slot.dataset.transitionCount = '3'; t.slot.dataset.activeVideoId = 'later';
        // Delayed consumer reads after a valid subsequent turn already began.
        await new Promise(resolve => setTimeout(resolve, 160));
      }
      results.push({ mode, proof: await proof, nowTurning: t.slot.classList.contains('is-turning'), number: t.slot.dataset.transitionCount });
    }
    return results;
  });
  await testInfo.attach('transition-instance-countercontrols', { body: JSON.stringify(results), contentType: 'application/json' });
  const expectedReasons = { empty: 'no-paused-transition', missing: 'invalid-paused-target',
    hung: 'transition-deadline', wrong: 'target-removed-or-replaced', removed: 'target-removed-or-replaced',
    source: 'target-removed-or-replaced', 'foreign-number': 'unobserved-or-foreign-completion',
    'foreign-slot': 'transition-deadline', previous: 'no-paused-transition', 'completed-then-next': 'captured-targets-settled',
    'resume-no-output':'resumed-target-no-output','resume-fresh-then-next':'captured-targets-settled','resume-old-epoch':'target-epoch-changed' };
  for (const row of results) {
    expect(row.proof.passed, row.mode).toBe(['completed-then-next','resume-fresh-then-next'].includes(row.mode));
    expect(row.proof.reason, row.mode).toBe(expectedReasons[row.mode]);
  }
  const success = results.find(row=>row.mode==='resume-fresh-then-next');
  expect(success.number).toBe('3'); expect(success.nowTurning).toBe(true);
  expect(success.proof.targets[0].completed.number).toBe('2');
  expect(success.proof.targets[0].completed.videoId).toBe(success.proof.targets[0].videoId);
});
