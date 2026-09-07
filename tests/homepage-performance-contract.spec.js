const { test, expect } = require('@playwright/test');
const { installHomepageWorkProbe, summarizeTaskWindow, assertHomepageWorkBudget } = require('./helpers/homepage-work-probe.cjs');

test('work-window arithmetic includes crossing tasks and excludes disjoint tasks', { tag: '@homepage-performance' }, () => {
  // Arithmetic unit control only; native performance values below use real clocks.
  const probe = { supported: true, overflow: false, error: '', entries: [
    { startTime: 20, duration: 80 }, { startTime: 90, duration: 80 },
    { startTime: 140, duration: 80 }, { startTime: 200, duration: 80 },
  ] };
  const result = summarizeTaskWindow(probe, 100, 200);
  expect(result.entries.map(entry => entry.startTime)).toEqual([90, 140]);
  expect(() => assertHomepageWorkBudget(result)).toThrow(/exceeds 50 ms/);
  expect(() => assertHomepageWorkBudget({ ...result, supported: false })).toThrow(/unavailable/);
  expect(() => assertHomepageWorkBudget({ ...result, overflow: true })).toThrow(/overflow/);
});

for (const boundary of ['input', 'completion']) {
  test(`native blocking countercontrol retains a task crossing ${boundary} despite delayed observation`, { tag: '@homepage-performance' }, async ({ page }) => {
    await page.addInitScript(installHomepageWorkProbe);
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      return route.fulfill({ contentType: 'text/html', body: '<button id="action">Perform local action</button>' });
    });
    await page.goto('/__homepage-work-control');
    await page.evaluate(boundary => {
      document.querySelector('#action').addEventListener('pointerdown', () => {
        const block = ms => { const end = performance.now() + ms; while (performance.now() < end) { /* deliberate test-only synchronous work */ } };
        // A task cannot be observed as completed from inside that very task.
        const taskEntered = performance.now();
        if (boundary === 'input') block(30);
        const startTime = performance.now();
        block(80);
        const endTime = performance.now();
        if (boundary === 'completion') block(30);
        window.__control = { startTime, endTime, taskEntered,
          deliveredInsideTask: window.__homepageWorkProbe.flush().entries.some(entry => entry.startTime + entry.duration >= taskEntered) };
      }, { once: true });
    }, boundary);
    await page.locator('#action').click();
    // Cross an actual rendering/task boundary, then drain queued native records.
    const result = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(() => {
      resolve({ control: window.__control, probe: window.__homepageWorkProbe.flush() });
    }, 0))));
    expect(result.control.deliveredInsideTask).toBe(false);
    const summary = summarizeTaskWindow(result.probe, result.control.startTime, result.control.endTime);
    expect(summary.entries.some(entry => entry.startTime < result.control.startTime && entry.duration >= 80)).toBe(true);
    expect(() => assertHomepageWorkBudget(summary)).toThrow(/exceeds 50 ms/);
    expect(summary.maxLongTaskMs).toBeGreaterThanOrEqual(100);
    await test.info().attach('native-negative-control', { body: JSON.stringify({ ...result.control, summary }), contentType: 'application/json' });
  });
}
