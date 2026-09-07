const { test, expect } = require('@playwright/test');

const SLOTS = '#hero [data-latest-models-slot]';
const VIDEOS = `${SLOTS} video`;

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
