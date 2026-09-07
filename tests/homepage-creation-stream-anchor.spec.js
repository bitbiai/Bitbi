const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const moduleSource = fs.readFileSync(path.join(__dirname, '../js/pages/index/creation-stream-anchor.js'), 'utf8');
const roles = [
  ['halo--main', .31], ['halo--upper', .24], ['halo--lower', .66], ['halo--violet', .78],
  ['strand--core', .31], ['strand--upper', .39], ['strand--cyan-a', .24], ['strand--cyan-b', .42],
  ['strand--cyan-c', .47], ['strand--lower', .62], ['strand--teal-low', .72], ['strand--magenta', .67],
  ['strand--magenta-b', .55], ['strand--violet', .8], ['strand--violet-bridge', .56], ['strand--gold', .5],
  ['strand--gold-fine', .58], ['strand--upper-fine', .34], ['strand--thread', .68],
  ['highlight--one', .31], ['highlight--two', .24], ['highlight--three', .62],
  ['highlight--four', .5], ['highlight--five', .55], ['highlight--six', .72], ['highlight--seven', .56],
];
function fixture() {
  const stream = side => `<div class="hero__creation-stream" data-creation-stream-side="${side}">
    <svg class="hero__creation-stream-svg" viewBox="0 0 1440 900" width="720" height="450">
      ${roles.map(([name, y]) => `<path class="hero__creation-stream-${name.split('--')[0]} hero__creation-stream-${name}" data-expected-y="${y}" d="M 700 650 C 720 650 900 400 950 400 C 1000 400 1100 300 1200 300"/>`).join('')}
      <circle class="hero__creation-stream-flare--origin"/><circle class="hero__creation-stream-particle" cx="700" cy="650"/>
      <circle class="hero__creation-stream-flare--top"/><circle class="hero__creation-stream-flare--bottom"/>
      <path class="hero__creation-stream-flare-ray--top"/><path class="hero__creation-stream-flare-ray--bottom"/>
    </svg></div>`;
  const module = side => `<div class="latest-models-video-module" data-latest-models-video-module-side="${side}" style="position:absolute;top:40px;left:${side === 'left' ? 40 : 560}px;width:130px;height:300px">
    <div data-latest-models-slot="top" style="height:140px"></div><div data-latest-models-slot="bottom" style="height:140px"></div>
    <svg viewBox="10 20 200 400" width="130" height="300" style="position:absolute;inset:0">
      <path class="latest-models-video-module__edge-glow-path--core" d="M 70 20 C 5 70 170 115 25 180 C 5 205 175 280 40 350 Q 80 385 50 420"/>
    </svg></div>`;
  return `<!doctype html><html><body style="margin:0"><section id="hero" style="position:relative;width:720px;height:500px">
    <button class="hero__lab-teaser" style="position:absolute;left:310px;top:350px;width:100px;height:35px">Generate</button>
    ${module('left')}${module('right')}${stream('left')}${stream('right')}
  </section></body></html>`;
}
async function openFixture(page, failure = '') {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/js/pages/index/creation-stream-anchor.js') return route.fulfill({ contentType: 'text/javascript', body: moduleSource });
    return route.fulfill({ contentType: 'text/html', body: fixture() });
  });
  await page.goto('/__creation-stream-anchor');
  await page.evaluate(async failure => {
    const frames = []; let active = null;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(now => {
      if (callback.name !== 'sync') return callback(now);
      active = { points: 0, lengths: 0, matrices: 0, writes: 0, readAfterWrite: 0 };
      try { return callback(now); } finally { frames.push(active); active = null; }
    });
    for (const [prototype, name, counter] of [
      [SVGGeometryElement.prototype, 'getTotalLength', 'lengths'],
      [SVGGeometryElement.prototype, 'getPointAtLength', 'points'],
      [SVGGraphicsElement.prototype, 'getScreenCTM', 'matrices'],
      [Element.prototype, 'getBoundingClientRect', 'rects'],
    ]) {
      const original = prototype[name];
      prototype[name] = function (...args) {
        if (active) { active[counter] = (active[counter] || 0) + 1; if (active.writes) active.readAfterWrite += 1; }
        return Reflect.apply(original, this, args);
      };
    }
    const set = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (active && ['d', 'cx', 'cy'].includes(name)) active.writes += 1;
      return Reflect.apply(set, this, [name, value]);
    };
    for (const edge of document.querySelectorAll('.latest-models-video-module__edge-glow-path--core')) {
      if (failure === 'zero-length') edge.getTotalLength = () => 0;
      if (failure === 'throw-length') edge.getTotalLength = () => { throw new Error('synthetic unavailable path'); };
      if (failure === 'no-matrix') edge.getScreenCTM = () => null;
    }
    window.__anchorFrames = frames;
    (await import('/js/pages/index/creation-stream-anchor.js')).initCreationStreamAnchor();
  }, failure);
  await expect(page.locator('[data-creation-stream-anchored="true"]')).toHaveCount(2);
}
async function geometry(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.hero__creation-stream')).map(stream => {
    const side = stream.dataset.creationStreamSide;
    const svg = stream.querySelector('svg');
    const edge = document.querySelector(`[data-latest-models-video-module-side="${side}"] .latest-models-video-module__edge-glow-path--core`);
    const expected = y => {
      // Independent native baseline algorithm: preserve 96 subdivisions, strict
      // first minimum, and both actual screen transforms. No copied product query.
      const targetY = edge.ownerSVGElement.viewBox.baseVal.y + edge.ownerSVGElement.viewBox.baseVal.height * y;
      const total = edge.getTotalLength(); let nearest; let distance = Infinity;
      for (let index = 0; index <= 96; index += 1) {
        const point = edge.getPointAtLength(total * index / 96);
        if (Math.abs(point.y - targetY) < distance) { nearest = point; distance = Math.abs(point.y - targetY); }
      }
      const point = new DOMPoint(nearest.x, nearest.y).matrixTransform(edge.getScreenCTM()).matrixTransform(svg.getScreenCTM().inverse());
      return [Number(point.x.toFixed(2)), Number(point.y.toFixed(2))];
    };
    const actual = Array.from(svg.querySelectorAll('[data-expected-y]')).map(route => ({
      actual: route.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number).slice(-2),
      expected: expected(Number(route.dataset.expectedY)),
    }));
    for (const [name, y] of [['top', .3], ['bottom', .66]]) {
      const flare = svg.querySelector(`.hero__creation-stream-flare--${name}`);
      actual.push({ actual: [Number(flare.getAttribute('cx')), Number(flare.getAttribute('cy'))], expected: expected(y) });
    }
    return { side, actual };
  }));
}

test('creation streams reuse exact native edge samples and read before writing on initial layout and resize', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openFixture(page);
  const first = await geometry(page);
  for (const stream of first) for (const point of stream.actual) expect(point.actual).toEqual(point.expected);
  const frameCount = await page.evaluate(() => window.__anchorFrames.length);
  await page.evaluate(() => {
    document.querySelector('[data-latest-models-video-module-side="left"]').style.transform = 'translate(23px, 11px) scale(.87)';
    document.querySelector('[data-latest-models-video-module-side="right"]').style.transform = 'translate(-18px, 7px) scale(1.06)';
    window.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() => window.__anchorFrames.length)).toBeGreaterThan(frameCount);
  const second = await geometry(page);
  expect(second).not.toEqual(first);
  for (const stream of second) for (const point of stream.actual) expect(point.actual).toEqual(point.expected);
  const frames = await page.evaluate(() => window.__anchorFrames);
  expect(frames.length).toBeGreaterThan(1);
  for (const frame of frames) {
    expect(frame.points).toBe(2 * 97);
    expect(frame.lengths).toBe(2);
    expect(frame.matrices).toBe(4);
    expect(frame.readAfterWrite).toBe(0);
    expect(frame.writes).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
  await testInfo.attach('native-svg-geometry-and-work', { contentType: 'application/json', body: JSON.stringify({ frames, first, second }) });
});

for (const failure of ['zero-length', 'throw-length', 'no-matrix']) {
  test(`creation streams retain finite side-specific fallback when edge geometry has ${failure}`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await openFixture(page, failure);
    const routes = await page.locator('[data-expected-y]').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')));
    expect(routes).toHaveLength(roles.length * 2);
    expect(routes.every(d => d && !/NaN|Infinity/.test(d))).toBe(true);
    const sides = await page.locator('.hero__creation-stream-flare--top').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('cx'))));
    expect(sides[0]).toBeLessThan(sides[1]);
    expect(errors).toEqual([]);
  });
}
