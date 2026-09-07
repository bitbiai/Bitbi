const { test, expect } = require('@playwright/test');
const { installHeroNativeProbe, everyActiveSlotProgressed } = require('./helpers/homepage-hero-native-probe');

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
