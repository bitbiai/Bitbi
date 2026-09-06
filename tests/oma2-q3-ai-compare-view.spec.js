const { test, expect } = require('@playwright/test');

const models = [
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', label: 'Compare A', task: 'text' },
  { id: '@cf/openai/gpt-oss-20b', label: 'Compare B', task: 'text' },
];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function openCompare(page, baseURL, { authGate = null } = {}) {
  const requests = []; const mutations = []; const unexpected = [];
  let authRequested = false;
  const literal = '<img src=x onerror="window.compareMarkupExecuted=true"> Literal A.';
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    requests.push(url);
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const user = { id: 'compare-admin', email: 'compare@example.test', role: 'admin' };
    let body;
    let status = 200;
    if (url.pathname === '/api/admin/me') { authRequested = true; await authGate?.promise; body = { ok: true, user }; }
    else if (url.pathname === '/api/me') body = { loggedIn: true, user };
    else if (url.pathname === '/api/admin/ai/models') body = { ok: true, presets: [], models: { text: models, image: [], embeddings: [], music: [], video: [] } };
    else if (url.pathname === '/api/admin/ai/compare') {
      const payload = request.postDataJSON(); mutations.push(payload);
      if (payload.prompt === 'failed replacement') { status = 503; body = { ok: false, code: 'upstream_error', error: 'Replacement unavailable' }; }
      else body = {
        ok: true, code: payload.prompt === 'partial result' ? 'partial_success' : null,
        elapsedMs: 17, warnings: payload.prompt === 'partial result' ? ['Only model A completed.'] : [],
        result: { results: [
          { ok: true, model: models[0], text: payload.prompt === 'identical result' ? 'Same result.' : `Shared sentence.\n${literal}`, usage: { total_tokens: 8 } },
          payload.prompt === 'partial result'
            ? { ok: false, model: models[1], error: 'Model B unavailable' }
            : { ok: true, model: models[1], text: payload.prompt === 'identical result' ? 'Same result.' : 'Shared sentence.\nDistinctive B.' },
        ], temperature: payload.temperature, maxTokens: payload.maxTokens },
      };
    } else {
      if (!['GET', 'HEAD'].includes(request.method())) unexpected.push(`${request.method()} ${url.pathname}`);
      status = 503; body = { ok: false, error: 'Unrelated local fixture unavailable' };
    }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
  await page.goto('/admin/index.html#ai-lab', { waitUntil: 'domcontentloaded' });
  if (authGate) {
    await expect.poll(() => authRequested).toBe(true);
    expect(requests.filter(url => /\/ai-lab(?:-compare-view)?\.(?:js|mjs)$/.test(url.pathname))).toEqual([]);
    authGate.resolve();
  }
  await expect(page.locator('#aiLabStatus')).toContainText('AI model catalog loaded');
  await page.locator('[data-ai-mode="compare"]:visible').click();
  await page.locator('#aiCompareModelA').selectOption(models[0].id);
  await page.locator('#aiCompareModelB').selectOption(models[1].id);
  return { requests, mutations, unexpected, literal };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`Compare view module ${viewport.width}px`, () => {
    test.use({ viewport });
    test('loads after the Admin gate and renders generated markup only as literal text', async ({ page, baseURL }) => {
      const gate = deferred();
      const { requests, mutations, unexpected, literal } = await openCompare(page, baseURL, { authGate: gate });
      const entry = requests.find(url => url.pathname.endsWith('/ai-lab.js'));
      const view = requests.find(url => url.pathname.endsWith('/ai-lab-compare-view.mjs'));
      expect(entry).toBeTruthy(); expect(view).toBeTruthy();
      expect(view.searchParams.get('v')).toBeTruthy();
      expect(view.searchParams.get('v')).toBe(entry.searchParams.get('v'));
      await page.locator('#aiComparePrompt').fill('Original comparison');
      await page.locator('#aiCompareRun').click();
      await expect(page.locator('#aiCompareAText')).toContainText(literal);
      await expect(page.locator('#aiCompareAUsage')).toHaveText('total_tokens: 8');
      await expect(page.locator('#aiCompareDiff')).toContainText('Shared sentence.');
      await page.locator('#aiComparePrompt').fill('Later draft');
      await page.locator('#aiCompareOnlyDifferences').check();
      await expect(page.locator('#aiCompareAText')).toHaveText(literal);
      await expect(page.locator('#aiCompareBText')).toHaveText('Distinctive B.');
      await expect(page.locator('#aiCompareACopyDiff')).toBeEnabled();
      await expect(page.locator('#aiCompareDiff')).not.toContainText('Shared Phrasing');
      await expect(page.locator('#aiCompareCardA img, #aiCompareCardA script, #aiCompareDiff img, #aiCompareDiff script')).toHaveCount(0);
      expect(await page.evaluate(() => window.compareMarkupExecuted)).toBeUndefined();
      await page.locator('#aiCompareOnlyDifferences').uncheck();
      await expect(page.locator('#aiCompareAText')).toContainText('Shared sentence.');
      expect(mutations).toHaveLength(1); expect(mutations[0].prompt).toBe('Original comparison');
      expect(unexpected).toEqual([]);
    });

    test('keeps identical, partial and failed replacement states distinct without discarding confirmed output', async ({ page, baseURL }) => {
      const { mutations, unexpected, literal } = await openCompare(page, baseURL);
      await page.locator('#aiComparePrompt').fill('identical result');
      await page.locator('#aiCompareRun').click();
      await expect(page.locator('#aiCompareState')).toContainText('Compare response ready.');
      await page.locator('#aiCompareOnlyDifferences').check();
      await expect(page.locator('#aiCompareACopyDiff')).toBeDisabled();
      await expect(page.locator('#aiCompareAText')).toContainText('Both outputs normalize to the same text.');
      await page.locator('#aiComparePrompt').fill('partial result');
      await page.locator('#aiCompareRun').click();
      await expect(page.locator('#aiCompareState')).toContainText('partial success');
      await expect(page.locator('#aiCompareAText')).toContainText(literal);
      await expect(page.locator('#aiCompareBError')).toHaveText('Model B unavailable');
      await expect(page.locator('#aiCompareACopyDiff')).toBeVisible();
      await expect(page.locator('#aiCompareACopyDiff')).toBeDisabled();
      await expect(page.locator('#aiCompareBCopyDiff')).toBeHidden();
      await expect(page.locator('#aiCompareWarnings')).toContainText('Only model A completed.');
      await page.locator('#aiComparePrompt').fill('failed replacement');
      await page.locator('#aiCompareRun').click();
      await expect(page.locator('#aiCompareState')).toContainText('Replacement unavailable');
      await expect(page.locator('#aiCompareState')).toContainText('Previous result preserved');
      await expect(page.locator('#aiCompareAText')).toContainText(literal);
      await expect(page.locator('#aiCompareBError')).toHaveText('Model B unavailable');
      expect(mutations).toHaveLength(3); expect(unexpected).toEqual([]);
    });
  });
}
