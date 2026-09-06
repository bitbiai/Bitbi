const { test, expect } = require('@playwright/test');

// Actual Admin controllers and API helpers, synthetic responses only. The local
// caller additionally confines browser/native traffic using the retained OS sandbox.
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const ok = data => ({ status: 200, body: { ok: true, data } });
const object = (bucket, key) => ({ type: 'object', bucket, key, name: key, contentType: 'text/plain', size: 9, appLink: { linked: false } });
async function mount(page, baseURL, kind, handler) {
  const origin = new URL(baseURL).origin;
  const unexpected = [];
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(url.origin); return route.abort(); }
    if (url.pathname === '/q3-media-fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><body><main><div id="objectStorageExplorer"></div><div id="newsFeedAgentAdmin"></div><section id="heroSection"><div id="homepageHeroVideosAdmin"></div></section></main></body></html>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const response = await handler(request, url);
    if (!response) { unexpected.push(request.method() + ' ' + url.pathname); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"Unconfigured synthetic route"}' }); }
    if (response.abort) return route.abort('failed');
    return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  await page.goto('/q3-media-fixture.html');
  await page.evaluate(async kind => {
    const defs = {
      r2: ['control-plane/object-storage.js', 'createObjectStorageDomain', 'loadObjectStorage'],
      news: ['news-feed-agent.js', 'createAdminNewsFeedAgent', 'load'],
      hero: ['homepage-hero-videos.js', 'createHomepageHeroVideosAdmin', 'load'],
    };
    const [path, factory, load] = defs[kind];
    const module = await import('/js/pages/admin/' + path);
    window.domain = module[factory]({ notify() {}, showToast() {}, formatDate: value => String(value || '—'), formatApiError: response => response.error || 'Synthetic failure' });
    window.domain.bind();
    await window.domain[load]();
  }, kind);
  return unexpected;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`Q3 media ${viewport.width}px`, () => {
    test.use({ viewport, timezoneId: 'Europe/Berlin' });

    test('R2 pages remain reachable, deduplicated and retryable within the bucket', async ({ page, baseURL }) => {
      let nextCalls = 0;
      const unexpected = await mount(page, baseURL, 'r2', (request, url) => {
        if (url.pathname.endsWith('/buckets')) return ok({ buckets: [{ id: 'USER_IMAGES' }] });
        if (url.pathname.endsWith('/objects')) {
          if (url.searchParams.get('cursor') === 'page-2') {
            nextCalls++;
            if (nextCalls === 1) return { status: 503, body: { error: 'Page unavailable' } };
            return ok({ objects: [object('USER_IMAGES', 'a.txt'), object('USER_IMAGES', 'second-page.txt')], hasMore: false });
          }
          return ok({ objects: [object('USER_IMAGES', 'a.txt')], hasMore: true, cursor: 'page-2' });
        }
      });
      await page.getByRole('checkbox', { name: 'Select a.txt', exact: true }).check();
      await page.getByRole('button', { name: 'Load more', exact: true }).press('Enter');
      await expect(page.locator('#objectStorageState')).toContainText('Page unavailable');
      await expect(page.getByRole('checkbox', { name: 'Select a.txt', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Load more', exact: true }).click();
      await expect(page.getByRole('button', { name: 'second-page.txt', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'a.txt', exact: true })).toHaveCount(1);
      await expect(page.getByRole('checkbox', { name: 'Select a.txt', exact: true })).toBeChecked();
      expect(nextCalls).toBe(2); expect(unexpected).toEqual([]);
    });

    test('R2 delayed list and detail A cannot replace bucket B, including failed A', async ({ page, baseURL }) => {
      const listA = deferred(), detailA = deferred(); let delayList = false, detailStarted = false;
      const unexpected = await mount(page, baseURL, 'r2', async (request, url) => {
        if (url.pathname.endsWith('/buckets')) return ok({ buckets: [{ id: 'USER_IMAGES' }, { id: 'PRIVATE_MEDIA' }] });
        if (url.pathname.endsWith('/objects/detail')) { detailStarted = true; await detailA.promise; return ok({ object: object('USER_IMAGES', 'a.txt') }); }
        if (url.pathname.endsWith('/objects')) {
          const bucket = url.searchParams.get('bucket');
          if (bucket === 'USER_IMAGES' && delayList) { await listA.promise; return { status: 503, body: { error: 'Old A failure' } }; }
          return ok({ objects: [object(bucket, bucket === 'USER_IMAGES' ? 'a.txt' : 'b.txt')] });
        }
      });
      await page.getByRole('button', { name: 'a.txt', exact: true }).click();
      await expect.poll(() => detailStarted).toBe(true);
      delayList = true;
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.locator('.admin-r2-bucket').filter({ hasText: 'PRIVATE_MEDIA' }).click();
      await expect(page.getByRole('button', { name: 'b.txt', exact: true })).toBeVisible();
      const oldResponses = [page.waitForResponse(response => response.url().includes('/objects?') && response.status() === 503), page.waitForResponse(response => response.url().includes('/objects/detail'))];
      listA.resolve(); detailA.resolve();
      await Promise.all(oldResponses);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#objectStorageState')).toContainText('PRIVATE_MEDIA');
      await expect(page.locator('#objectStorageDetail')).not.toContainText('a.txt');
      expect(unexpected).toEqual([]);
    });

    test('R2 mutation is pinned, single-flight, and explicit unknown retry reuses the key', async ({ page, baseURL }) => {
      const held = deferred(); const mutations = []; let attempt = 0;
      const unexpected = await mount(page, baseURL, 'r2', async (request, url) => {
        if (url.pathname.endsWith('/buckets')) return ok({ buckets: [{ id: 'USER_IMAGES' }, { id: 'PRIVATE_MEDIA' }] });
        if (url.pathname.endsWith('/objects')) return ok({ objects: [object(url.searchParams.get('bucket'), 'a.txt')] });
        if (url.pathname.endsWith('/objects/move')) {
          mutations.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
          if (++attempt === 1) { await held.promise; return { abort: true }; }
          return ok({ results: [{ ok: true }] });
        }
      });
      page.on('dialog', dialog => dialog.accept('Synthetic reason'));
      await page.getByRole('checkbox', { name: 'Select a.txt', exact: true }).check();
      await page.getByRole('button', { name: 'Cut', exact: true }).click();
      await page.getByRole('button', { name: 'Paste', exact: true }).evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => mutations.length).toBe(1);
      await page.locator('.admin-r2-bucket').filter({ hasText: 'PRIVATE_MEDIA' }).click();
      held.resolve();
      await expect(page.locator('#objectStorageMutationResult')).toContainText('Verify');
      await expect(page.locator('#objectStorageState')).toContainText('PRIVATE_MEDIA');
      await page.locator('.admin-r2-bucket').filter({ hasText: 'USER_IMAGES' }).click();
      await page.getByRole('button', { name: 'Paste', exact: true }).click();
      await expect.poll(() => mutations.length).toBe(2);
      expect(mutations[0]).toEqual(mutations[1]);
      expect(mutations[0].body.targetBucket).toBe('USER_IMAGES');
      expect(unexpected).toEqual([]);
    });

    for (const original of ['2026-06-17T10:12:34.567Z', '2026-10-25T01:30:00.123Z']) {
      test(`News title save preserves exact UTC ${original}, expiry clear and reopen`, async ({ page, baseURL }) => {
        const saved = []; let item = { id: 'news-a', title: 'Synthetic A', locale: 'en', status: 'active', published_at: original, expires_at: '2026-12-12T11:45:12.345Z', url: 'https://example.test/news', summary: 'Synthetic summary' };
        const unexpected = await mount(page, baseURL, 'news', (request, url) => {
          if (url.pathname.endsWith('/overview')) return ok({ counts: { active: 1 }, generated_at: '2026-09-06T10:00:00Z' });
          if (url.pathname.endsWith('/visibility')) return ok({ settings: { desktop: { enabled: true }, mobile: { enabled: true } } });
          if (url.pathname.endsWith('/items/news-a')) {
            if (request.method() === 'PATCH') { saved.push(request.postDataJSON()); item = { ...item, ...saved.at(-1) }; }
            return ok({ item });
          }
          if (url.pathname.endsWith('/items')) return ok({ items: [item] });
        });
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await page.locator('#newsPulseEditTitle').fill('Changed title');
        await page.locator('#newsPulseEditReason').fill('Synthetic title correction');
        await page.getByRole('button', { name: 'Save item', exact: true }).evaluate(button => { button.click(); button.click(); });
        await expect.poll(() => saved.length).toBeGreaterThanOrEqual(1);
        expect(saved[0].published_at).toBe(original);
        expect(saved).toHaveLength(1);
        expect(saved[0].expires_at).toBe('2026-12-12T11:45:12.345Z');
        await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Changed title');
        await page.locator('#newsPulseEditExpires').fill('');
        await page.locator('#newsPulseEditReason').fill('Synthetic clear expiry');
        await page.getByRole('button', { name: 'Save item', exact: true }).click();
        await expect.poll(() => saved.length).toBe(2);
        expect(saved[1].expires_at).toBeNull(); expect(saved[1].published_at).toBe(original);
        expect(unexpected).toEqual([]);
      });
    }

    test('News refresh/selection retains editable draft and focus; nonexistent DST time is rejected', async ({ page, baseURL }) => {
      let writes = 0;
      const item = { id: 'news-a', title: 'Synthetic A', status: 'active', published_at: '2026-06-17T10:00:00Z' };
      await mount(page, baseURL, 'news', (request, url) => {
        if (request.method() !== 'GET') { writes++; return ok({}); }
        if (url.pathname.endsWith('/overview')) return ok({ counts: { active: 1 } });
        if (url.pathname.endsWith('/visibility')) return ok({ settings: {} });
        if (url.pathname.endsWith('/items/news-a')) return ok({ item });
        if (url.pathname.endsWith('/items')) return ok({ items: [item] });
      });
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#newsPulseEditTitle').fill('Unsaved local draft');
      await page.locator('#newsPulseEditTitle').focus();
      await page.evaluate(() => window.domain.load());
      await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Unsaved local draft');
      await expect(page.locator('#newsPulseEditTitle')).toBeFocused();
      await page.locator('#newsPulseEditPublished').fill('2026-03-29T02:30');
      await page.locator('#newsPulseEditReason').fill('Synthetic DST gap');
      await page.getByRole('button', { name: 'Save item', exact: true }).click();
      await expect(page.locator('[data-news-pulse-status]')).toContainText('does not exist');
      expect(writes).toBe(0);
    });

    test('News delayed save A retains draft B and one original request on explicit retry', async ({ page, baseURL }) => {
      const held = deferred(); const writes = []; let aCalls = 0;
      const rows = ['a', 'b'].map(id => ({ id: `news-${id}`, title: `Synthetic ${id.toUpperCase()}`, status: 'active', published_at: '2026-06-17T10:00:00Z' }));
      const unexpected = await mount(page, baseURL, 'news', async (request, url) => {
        if (url.pathname.endsWith('/overview')) return ok({ counts: { active: 2 } });
        if (url.pathname.endsWith('/visibility')) return ok({ settings: {} });
        if (url.pathname.endsWith('/items')) return ok({ items: rows });
        const item = rows.find(row => url.pathname.endsWith('/items/' + row.id));
        if (item) {
          if (request.method() === 'PATCH') {
            writes.push({ id: item.id, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
            if (++aCalls === 1) { await held.promise; return { status: 503, body: { error: 'Save A unavailable' } }; }
            Object.assign(item, request.postDataJSON());
          }
          return ok({ item });
        }
      });
      await page.locator('[data-news-pulse-edit="news-a"]').click();
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-a');
      await page.locator('#newsPulseEditTitle').fill('Changed A');
      await page.locator('#newsPulseEditReason').fill('Synthetic A reason');
      await page.getByRole('button', { name: 'Save item', exact: true }).evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => writes.length).toBe(1);
      await page.locator('[data-news-pulse-edit="news-b"]').click();
      await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Synthetic B');
      await page.locator('#newsPulseEditTitle').fill('Unfinished B');
      held.resolve();
      await expect(page.locator('[data-news-pulse-status]')).toContainText('Save A unavailable');
      await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Unfinished B');
      // A is deliberately reopened and the same explicit intent is resubmitted.
      await page.locator('[data-news-pulse-edit="news-a"]').click();
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-a');
      await page.locator('#newsPulseEditTitle').fill('Changed A');
      await page.locator('#newsPulseEditReason').fill('Synthetic A reason');
      await page.getByRole('button', { name: 'Save item', exact: true }).click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[0]).toEqual(writes[1]);
      expect(unexpected).toEqual([]);
    });

    test('News obsolete A detail and successful A save cannot overwrite the current B editor', async ({ page, baseURL }) => {
      const oldDetail = deferred(), oldSave = deferred(); let holdDetail = true; let detailStarted = false, saveStarted = false;
      const rows = ['a', 'b'].map(id => ({ id: `news-${id}`, title: `Synthetic ${id.toUpperCase()}`, status: 'active', published_at: '2026-06-17T10:00:00Z' }));
      const unexpected = await mount(page, baseURL, 'news', async (request, url) => {
        if (url.pathname.endsWith('/overview')) return ok({ counts: { active: 2 } });
        if (url.pathname.endsWith('/visibility')) return ok({ settings: {} });
        if (url.pathname.endsWith('/items')) return ok({ items: rows });
        const item = rows.find(row => url.pathname.endsWith('/items/' + row.id));
        if (item) {
          if (item.id === 'news-a' && request.method() === 'GET' && holdDetail) { detailStarted = true; await oldDetail.promise; }
          if (request.method() === 'PATCH') { saveStarted = true; await oldSave.promise; Object.assign(item, request.postDataJSON()); }
          return ok({ item });
        }
      });
      await page.locator('[data-news-pulse-edit="news-a"]').click();
      await expect.poll(() => detailStarted).toBe(true);
      await page.locator('[data-news-pulse-edit="news-b"]').click();
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-b');
      const detailResponse = page.waitForResponse(response => response.url().endsWith('/items/news-a'));
      holdDetail = false; oldDetail.resolve(); await detailResponse;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-b');
      await page.locator('[data-news-pulse-edit="news-a"]').click();
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-a');
      await page.locator('#newsPulseEditTitle').fill('Saved A');
      await page.locator('#newsPulseEditReason').fill('Synthetic saved A');
      await page.getByRole('button', { name: 'Save item', exact: true }).press('Enter');
      await expect.poll(() => saveStarted).toBe(true);
      await page.locator('[data-news-pulse-edit="news-b"]').click();
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-b');
      await page.locator('#newsPulseEditTitle').fill('Unsaved B');
      const listResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/items'));
      oldSave.resolve(); await listResponse;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#newsPulseEditPanel')).toHaveAttribute('data-item-id', 'news-b');
      await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Unsaved B');
      expect(rows[0].title).toBe('Saved A'); expect(unexpected).toEqual([]);
    });

    test('News edited summer and winter local times serialize deliberately, with missing expiry allowed', async ({ page, baseURL }) => {
      const writes = []; let item = { id: 'news-a', title: 'Synthetic A', status: 'active', published_at: '2026-06-17T10:00:00Z', expires_at: null };
      const unexpected = await mount(page, baseURL, 'news', (request, url) => {
        if (url.pathname.endsWith('/overview')) return ok({ counts: { active: 1 } });
        if (url.pathname.endsWith('/visibility')) return ok({ settings: {} });
        if (url.pathname.endsWith('/items/news-a')) {
          if (request.method() === 'PATCH') { writes.push(request.postDataJSON()); item = { ...item, ...writes.at(-1) }; }
          return ok({ item });
        }
        if (url.pathname.endsWith('/items')) return ok({ items: [item] });
      });
      for (const [local, utc] of [['2026-07-01T14:30', '2026-07-01T12:30:00.000Z'], ['2026-12-01T14:30', '2026-12-01T13:30:00.000Z']]) {
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await page.locator('#newsPulseEditPublished').fill(local);
        await page.locator('#newsPulseEditReason').fill('Synthetic time change');
        await page.getByRole('button', { name: 'Save item', exact: true }).click();
        await expect(page.locator('#newsPulseEditTitle')).toHaveCount(0);
        expect(writes.at(-1).published_at).toBe(utc);
        expect(writes.at(-1).expires_at).toBeNull();
      }
      expect(unexpected).toEqual([]);
    });

    test('News pending save keeps newer same-row title and summary explicitly unsaved', async ({ page, baseURL }) => {
      const held = deferred(), writes = []; let item = { id: 'news-a', title: 'Original', summary: 'Original summary', status: 'active', published_at: '2026-06-17T10:00:00Z' };
      const unexpected = await mount(page, baseURL, 'news', async (request, url) => {
        if (url.pathname.endsWith('/overview')) return ok({ counts: { active: 1 } });
        if (url.pathname.endsWith('/visibility')) return ok({ settings: {} });
        if (url.pathname.endsWith('/items')) return ok({ items: [item] });
        if (url.pathname.endsWith('/items/news-a')) {
          if (request.method() === 'PATCH') { writes.push(request.postDataJSON()); if (writes.length === 1) await held.promise; item = { ...item, ...writes.at(-1) }; }
          return ok({ item });
        }
      });
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#newsPulseEditTitle').fill('Saved title A'); await page.locator('#newsPulseEditSummary').fill('Saved summary A');
      await page.locator('#newsPulseEditReason').fill('Synthetic original save');
      await page.getByRole('button', { name: 'Save item', exact: true }).click(); await expect.poll(() => writes.length).toBe(1);
      await page.locator('#newsPulseEditTitle').fill('Unsaved title B'); await page.locator('#newsPulseEditSummary').fill('Unsaved summary B');
      held.resolve(); await expect(page.locator('[data-news-pulse-status]')).toContainText('Current edits remain unsaved');
      await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Unsaved title B'); await expect(page.locator('#newsPulseEditSummary')).toHaveValue('Unsaved summary B');
      expect(item.title).toBe('Saved title A'); expect(item.summary).toBe('Saved summary A');
      await page.getByRole('button', { name: 'Save item', exact: true }).click();
      await expect(page.locator('#newsPulseEditTitle')).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Unsaved title B'); await expect(page.locator('#newsPulseEditSummary')).toHaveValue('Unsaved summary B');
      expect(writes.length).toBe(2); expect(unexpected).toEqual([]);
    });

    test('News visibility completion while hidden performs no follow-up reads', async ({ page, baseURL }) => {
      const held = deferred(); let reads = 0, saving = false; let settings = { desktop: { enabled: true }, mobile: { enabled: true } };
      const unexpected = await mount(page, baseURL, 'news', async (request, url) => {
        if (request.method() === 'GET') reads++;
        if (url.pathname.endsWith('/overview')) return ok({ counts: {} });
        if (url.pathname.endsWith('/items')) return ok({ items: [] });
        if (url.pathname.endsWith('/visibility')) {
          if (request.method() === 'PATCH') { saving = true; await held.promise; settings = { desktop: { enabled: request.postDataJSON().desktop_enabled }, mobile: { enabled: true } }; }
          return ok({ settings });
        }
      });
      await page.locator('#newsPulseDesktopEnabled').uncheck(); await page.locator('#newsPulseVisibilityReason').fill('Synthetic visibility edit');
      await page.getByRole('button', { name: 'Save visibility', exact: true }).click(); await expect.poll(() => saving).toBe(true);
      await page.evaluate(() => window.domain.setActive(false)); const before = reads;
      held.resolve(); await expect(page.locator('[data-news-pulse-status]')).toContainText('visibility updated');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(reads).toBe(before);
      await page.evaluate(async () => { window.domain.setActive(true); await window.domain.load(); });
      await expect(page.locator('#newsPulseDesktopEnabled')).not.toBeChecked(); expect(reads).toBe(before + 3); expect(unexpected).toEqual([]);
    });

    test('R2 bucket discovery completing after leave starts no object scan', async ({ page, baseURL }) => {
      const held = deferred(); let buckets = 0, objects = 0;
      const mounted = mount(page, baseURL, 'r2', async (request, url) => {
        if (url.pathname.endsWith('/buckets')) { if (++buckets === 1) await held.promise; return ok({ buckets: [{ id: 'USER_IMAGES' }] }); }
        if (url.pathname.endsWith('/objects')) { objects++; return ok({ objects: [object('USER_IMAGES', 'safe.txt')], hasMore: false }); }
      });
      await expect.poll(() => buckets).toBe(1); await page.evaluate(() => window.domain.setActive(false)); held.resolve();
      const unexpected = await mounted; expect(objects).toBe(0);
      await page.evaluate(async () => { window.domain.setActive(true); await window.domain.loadObjectStorage(); });
      await expect(page.locator('#objectStorageTable')).toContainText('safe.txt'); expect(buckets).toBe(2); expect(objects).toBe(1); expect(unexpected).toEqual([]);
    });

    for (const [responseStatus, changeSelection] of [[200, true], [503, true], [200, false]]) test(`Hero retry response ${responseStatus} stays with original conversion; switch=${changeSelection}`, async ({ page, baseURL }) => {
      const held = deferred(); const writes = [], polls = [];
      const a = { id: 'job-a', source_title: 'Conversion A', status: 'failed', slot: 'right_top', source_asset_id: 'source-a', source_type: 'public' };
      const b = { id: 'job-b', source_title: 'Conversion B', status: 'succeeded', slot: 'right_bottom', source_asset_id: 'source-b', source_type: 'public' };
      const unexpected = await mount(page, baseURL, 'hero', async (request, url) => {
        if (url.pathname.endsWith('/hero-videos')) return ok({ slots: [], preset_status: { preset: { maxWidth: 720 } }, feature_status: { features: {} } });
        if (url.pathname.endsWith('/candidates')) return ok({ candidates: [] });
        if (url.pathname.endsWith('/derivatives')) return ok({ derivatives: [a, b] });
        if (url.pathname.endsWith('/derivatives/job-a/retry')) { writes.push(request.postDataJSON()); await held.promise; return responseStatus === 200 ? ok({ derivative: { ...a, status: 'queued' } }) : { status: 503, body: { ok: false, error: 'Synthetic retry not confirmed' } }; }
        if (url.pathname.endsWith('/derivatives/job-a')) { polls.push('job-a'); return ok({ derivative: { ...a, status: 'queued' } }); }
      });
      await page.locator('[data-action="select-derivative"][data-derivative-id="job-a"]').click();
      await page.locator('[data-field="reason"]').fill('Synthetic retry A');
      await page.locator('[data-action="retry-derivative"][data-derivative-id="job-a"]').evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => writes.length).toBe(1);
      if (changeSelection) await page.locator('[data-action="select-derivative"][data-derivative-id="job-b"]').click();
      held.resolve();
      await expect(page.locator('article[data-derivative-id="job-a"]')).toContainText(responseStatus === 200 ? 'Retry job-a queued.' : 'Retry job-a not confirmed');
      if (changeSelection) {
        await expect(page.locator('article[data-derivative-id="job-b"]')).toHaveClass(/--selected/);
        await expect(page.locator('[data-homepage-hero-status]')).toContainText('Selected conversion job-b: succeeded');
        expect(polls).toEqual([]);
      } else { await expect.poll(() => polls.length).toBe(1); await expect(page.locator('article[data-derivative-id="job-a"]')).toHaveClass(/--selected/); }
      expect(writes.length).toBe(1); expect(unexpected).toEqual([]);
    });

    test('Hero hidden lifecycle stops reads and preset draft/focus survive refresh', async ({ page, baseURL }) => {
      let polls = 0; const presetWrites = []; let preset = { maxWidth: 1080, fps: 24 };
      const derivative = { id: 'job-a', slot: 'right_top', source_type: 'public', source_asset_id: 'asset-a', status: 'processing' };
      const unexpected = await mount(page, baseURL, 'hero', (request, url) => {
        if (url.pathname.endsWith('/hero-videos')) return ok({ slots: [], preset_status: { preset }, feature_status: { features: {} } });
        if (url.pathname.endsWith('/preset') && request.method() === 'PATCH') { presetWrites.push(request.postDataJSON()); preset = presetWrites.at(-1).preset; return ok({ preset_status: { preset } }); }
        if (url.pathname.endsWith('/candidates')) return ok({ candidates: [] });
        if (url.pathname.endsWith('/derivatives')) return ok({ derivatives: [derivative] });
        if (url.pathname.endsWith('/derivatives/job-a')) { polls++; return ok({ derivative }); }
      });
      await page.locator('[data-preset-field="maxWidth"]').fill('720');
      await page.locator('[data-preset-field="maxWidth"]').focus();
      await page.evaluate(() => window.domain.load());
      await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
      await expect(page.locator('[data-preset-field="maxWidth"]')).toBeFocused();
      await page.clock.install();
      await page.getByRole('button', { name: 'Select derivative', exact: true }).click();
      await expect.poll(() => polls).toBe(1);
      await page.evaluate(() => { window.domain.setActive(false); document.querySelector('#heroSection').hidden = true; });
      await page.clock.fastForward(16000);
      expect(polls).toBe(1);
      await page.evaluate(() => { document.querySelector('#heroSection').hidden = false; window.domain.setActive(true); });
      await page.clock.fastForward(4100);
      await expect.poll(() => polls).toBe(2);
      await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
      await page.locator('[data-field="reason"]').fill('Synthetic conversion preset change');
      await page.getByRole('button', { name: 'Save preset', exact: true }).evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => presetWrites.length).toBe(1);
      expect(presetWrites[0].preset.maxWidth).toBe(720);
      await page.evaluate(() => window.domain.load());
      await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
      expect(unexpected).toEqual([]);
    });
  });
}
