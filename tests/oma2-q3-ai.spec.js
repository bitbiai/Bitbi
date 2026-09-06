const { test, expect } = require('@playwright/test');

// Actual admin modules against local synthetic APIs. The external runner denies
// non-localhost networking for browsers and native children; no Worker is started.
const textModels = [
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', label: 'Q3 Fast', task: 'text', vendor: 'Fixture' },
  { id: '@cf/openai/gpt-oss-20b', label: 'Q3 Balanced', task: 'text', vendor: 'Fixture' },
];
const catalog = {
  ok: true,
  presets: [
    { name: 'fast', task: 'text', model: textModels[0].id },
    { name: 'balanced', task: 'text', model: textModels[1].id },
    { name: 'embedding_default', task: 'embeddings', model: '@cf/baai/bge-m3' },
    { name: 'image_fast', task: 'image', model: '@cf/black-forest-labs/flux-1-schnell' },
  ],
  models: { text: textModels, embeddings: [{ id: '@cf/baai/bge-m3', label: 'Q3 Embeddings', task: 'embeddings' }],
    image: [{ id: '@cf/black-forest-labs/flux-1-schnell', label: 'Q3 Image', task: 'image' }], music: [], video: [] },
};
const admin = { id: 'q3-admin', email: 'q3-admin@example.test', role: 'admin' };
const folders = { ok: true, data: { folders: [{ id: 'folder-a', name: 'Folder A' }, { id: 'folder-b', name: 'Folder B' }], counts: {} } };
const tasks = {
  text: { mode: 'text', prefix: 'aiText', input: 'aiTextPrompt', endpoint: 'test-text' },
  embeddings: { mode: 'embeddings', prefix: 'aiEmbeddings', input: 'aiEmbeddingsInput', endpoint: 'test-embeddings' },
  compare: { mode: 'compare', prefix: 'aiCompare', input: 'aiComparePrompt', endpoint: 'compare' },
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function responseFor(task, request) {
  return { ok: true, task, model: textModels[0], warnings: [], elapsedMs: 10,
    result: task === 'text' ? { text: 'Output belonging to A', maxTokens: request.maxTokens, temperature: request.temperature }
      : task === 'embeddings' ? { vectors: [[0.11, 0.22], [0.33, 0.44]], count: 2, dimensions: 2 }
        : { results: textModels.map((model, index) => ({ ok: true, model, text: `A output ${index}` })), maxTokens: request.maxTokens, temperature: request.temperature } };
}
async function fixture(page, baseURL, custom = () => null) {
  const unexpected = [];
  const requests = [];
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: url.pathname, method: request.method() });
    let result = await custom(request, url);
    if (!result && url.pathname === '/api/admin/me') result = { body: { ok: true, user: admin } };
    if (!result && url.pathname === '/api/me') result = { body: { loggedIn: true, user: admin } };
    if (!result && url.pathname === '/api/admin/ai/models') result = { body: catalog };
    if (!result && url.pathname === '/api/admin/orgs') result = { body: { ok: true, organizations: [] } };
    if (!result && url.pathname === '/api/ai/folders') result = { body: folders };
    if (!result && url.pathname === '/api/ai/assets') result = { body: { ok: true, data: { assets: [], has_more: false } } };
    if (!result) {
      if (!['GET', 'HEAD'].includes(request.method())) unexpected.push(`${request.method()} ${url.pathname}`);
      result = { status: 503, body: { ok: false, error: 'Unrelated fixture unavailable' } };
    }
    if (result.abort) return route.abort('failed');
    return route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.body) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false }));
  });
  await page.goto('/admin/index.html#ai-lab', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminPanel')).toBeVisible();
  await expect(page.locator('#aiLabStatus')).toContainText('AI model catalog loaded');
  return { unexpected, requests };
}
async function mode(page, task) {
  await page.locator(`[data-ai-mode="${task}"]:visible`).click();
  await expect(page.locator(`#${tasks[task].prefix}Run`)).toBeEnabled();
}
async function generate(page, task, input = 'Prompt A') {
  await mode(page, task);
  await page.locator(`#${tasks[task].input}`).fill(input);
  await page.locator(`#${tasks[task].prefix}Run`).click();
  await expect(page.locator(`#${tasks[task].prefix}Save`)).toBeVisible();
}
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`Q3 AI result identity ${viewport.width}px`, () => {
    test.use({ viewport });
    for (const task of Object.keys(tasks)) {
      test(`${task}: request A survives draft B, failed B, filename edit and save double submit`, async ({ page, baseURL }) => {
        const generation = deferred(); const saving = deferred(); const saves = []; const generations = [];
        const { unexpected } = await fixture(page, baseURL, async (request, url) => {
          if (url.pathname === '/api/admin/ai/' + tasks[task].endpoint) {
            const body = request.postDataJSON(); generations.push(body);
            if (generations.length > 1) return { status: 503, body: { ok: false, error: 'B is unavailable' } };
            await generation.promise;
            return { body: responseFor(task, body) };
          }
          if (url.pathname === '/api/admin/ai/save-text-asset') {
            saves.push(request.postDataJSON()); await saving.promise;
            return { status: 201, body: { ok: true, data: { id: 'asset-a' } } };
          }
        });
        await mode(page, task);
        await page.locator(`#${tasks[task].input}`).fill(task === 'embeddings' ? 'First A\nSecond A' : 'Prompt A');
        if (task !== 'embeddings') await page.locator(`#${tasks[task].prefix}System`).fill('System A');
        await page.locator(`#${tasks[task].prefix}Run`).evaluate(el => { el.click(); el.click(); });
        await expect.poll(() => generations.length).toBe(1);
        await page.locator(`#${tasks[task].input}`).fill('Draft B');
        if (task !== 'embeddings') await page.locator(`#${tasks[task].prefix}System`).fill('System B');
        generation.resolve();
        await expect(page.locator(`#${tasks[task].prefix}Save`)).toBeVisible();
        await page.locator(`#${tasks[task].prefix}Run`).click();
        await expect(page.locator(`#${tasks[task].prefix}State`)).toContainText('Previous result preserved');
        await page.locator(`#${tasks[task].prefix}Save`).click();
        await expect(page.locator('#aiLabSaveState')).toContainText('Choose a folder');
        await page.locator('#aiLabSaveInput').fill('Editorial filename, not provenance');
        await page.locator('#aiLabSaveFolder').selectOption('folder-a');
        await page.locator('#aiLabSaveConfirm').evaluate(el => { el.click(); el.click(); });
        await expect.poll(() => saves.length).toBe(1);
        if (task === 'embeddings') expect(saves[0].data).toMatchObject({ inputItems: ['First A', 'Second A'], vectors: [[0.11, 0.22], [0.33, 0.44]] });
        else expect(saves[0].data).toMatchObject({ prompt: 'Prompt A', system: 'System A' });
        // An old Save button cannot replace an in-flight confirmation even when
        // a queued DOM activation runs after the visible button was disabled.
        await page.locator(`#${tasks[task].prefix}Save`).evaluate(el => el.click());
        await expect(page.locator('#aiLabSaveConfirm')).toBeDisabled();
        saving.resolve();
        await expect(page.locator('#aiLabSaveModal')).toBeHidden();
        await expect(page.locator(`#${tasks[task].input}`)).toHaveValue('Draft B');
        expect(saves[0]).toMatchObject({ title: 'Editorial filename, not provenance', folderId: 'folder-a', sourceModule: task });
        if (task === 'embeddings') expect(saves[0].data).toMatchObject({ inputItems: ['First A', 'Second A'], vectors: [[0.11, 0.22], [0.33, 0.44]] });
        else expect(saves[0].data).toMatchObject({ prompt: 'Prompt A', system: 'System A' });
        await page.locator(`#${tasks[task].prefix}Save`).click();
        await expect(page.locator('#aiLabSaveConfirm')).toHaveText('Already saved');
        await expect(page.locator('#aiLabSaveConfirm')).toBeDisabled();
        await page.locator('#aiLabSaveCancel').press('Escape');
        await expect(page.locator(`#${tasks[task].prefix}Save`)).toBeFocused();
        expect(saves).toHaveLength(1);
        if (task === 'text') {
          await page.locator('#aiTextSave').click();
          await page.locator('#aiLabSaveNewCopy').click();
          await page.locator('#aiLabSaveInput').fill('An explicitly requested second copy');
          await page.locator('#aiLabSaveFolder').selectOption('folder-b');
          await page.locator('#aiLabSaveConfirm').click();
          await expect(page.locator('#aiLabSaveModal')).toBeHidden();
          expect(saves).toHaveLength(2);
          expect(saves[1]).toMatchObject({ title: 'An explicitly requested second copy', folderId: 'folder-b', data: saves[0].data });
        }
        expect(unexpected).toEqual([]);
      });
    }
    test('late folder result cannot overwrite or focus reopened B; folder failure recovers', async ({ page, baseURL }) => {
      let holdFolders = false; let failure = false; let lateCount = 0; const late = deferred();
      const { unexpected } = await fixture(page, baseURL, async (request, url) => {
        if (url.pathname === '/api/admin/ai/test-text') return { body: responseFor('text', request.postDataJSON()) };
        if (url.pathname === '/api/ai/folders' && holdFolders) {
          lateCount += 1;
          if (lateCount === 1) { await late.promise; return { body: { ok: true, data: { folders: [{ id: 'old-only', name: 'Old folder' }] } } }; }
          if (failure) return { status: 503, body: { ok: false, error: 'Folders unavailable' } };
        }
      });
      await generate(page, 'text'); holdFolders = true;
      await page.locator('#aiTextSave').click(); await expect.poll(() => lateCount).toBe(1);
      await page.locator('#aiLabSaveCancel').press('Escape');
      await expect(page.locator('#aiTextSave')).toBeFocused();
      failure = true;
      await page.locator('#aiTextSave').click();
      await expect(page.locator('#aiLabSaveState')).toContainText('Folder list unavailable');
      await page.locator('#aiLabSaveCancel').click(); failure = false;
      await page.locator('#aiTextSave').click();
      await expect(page.locator('#aiLabSaveState')).toContainText('Choose a folder');
      await page.locator('#aiLabSaveInput').fill('B filename');
      await page.locator('#aiLabSaveFolder').selectOption('folder-b');
      await page.locator('#aiLabSaveCancel').focus();
      late.resolve();
      await expect(page.locator('#aiLabSaveFolder')).toHaveValue('folder-b');
      await expect(page.locator('#aiLabSaveInput')).toHaveValue('B filename');
      await expect(page.locator('#aiLabSaveCancel')).toBeFocused();
      await page.locator('#aiLabSaveCancel').press('Tab');
      await expect(page.locator('#aiLabSaveModal [data-ai-save-close]').filter({ hasText: 'Close' })).toBeFocused();
      expect(unexpected).toEqual([]);
    });
    test('leaving AI Lab retains a running save and defers saved-assets reads until needed', async ({ page, baseURL }) => {
      const saving = deferred(); const saves = [];
      const { requests, unexpected } = await fixture(page, baseURL, async (request, url) => {
        if (url.pathname === '/api/admin/ai/test-text') return { body: responseFor('text', request.postDataJSON()) };
        if (url.pathname === '/api/admin/ai/save-text-asset') {
          saves.push(request.postDataJSON()); await saving.promise;
          return { status: 201, body: { ok: true, data: { id: 'hidden-save-a' } } };
        }
      });
      expect(requests.filter(r => r.path === '/api/admin/orgs')).toHaveLength(0);
      await generate(page, 'text');
      await page.locator('#aiTextSave').click();
      await expect(page.locator('#aiLabSaveState')).toContainText('Choose a folder');
      await page.locator('#aiLabSaveConfirm').click();
      await expect.poll(() => saves.length).toBe(1);
      const readsBefore = requests.filter(r => ['/api/ai/folders', '/api/ai/assets'].includes(r.path)).length;
      await page.evaluate(() => { location.hash = 'dashboard'; });
      await expect(page.locator('#sectionAiLab')).not.toBeVisible();
      const completion = page.waitForResponse(r => r.url().endsWith('/api/admin/ai/save-text-asset'));
      saving.resolve(); await (await completion).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      expect(requests.filter(r => ['/api/ai/folders', '/api/ai/assets'].includes(r.path))).toHaveLength(readsBefore);
      await page.evaluate(() => { location.hash = 'ai-lab'; });
      await expect(page.locator('#aiTextSave')).toBeVisible();
      await page.locator('#aiTextSave').click();
      await expect(page.locator('#aiLabSaveConfirm')).toHaveText('Already saved');
      await page.locator('#aiLabSaveCancel').click();
      await page.locator('[data-ai-mode="image"]:visible').click();
      await expect.poll(() => requests.filter(r => r.path === '/api/admin/orgs').length).toBe(1);
      await expect.poll(() => requests.filter(r => r.path === '/api/ai/folders').length).toBeGreaterThan(readsBefore);
      expect(saves).toHaveLength(1); expect(unexpected).toEqual([]);
    });
    test('video status viewing pauses outside its panel and resumes the same job without a second generation', async ({ page, baseURL }) => {
      let creates = 0; let reads = 0;
      const videoCatalog = structuredClone(catalog);
      videoCatalog.models.video = [{ id: 'pixverse/v6', task: 'video', label: 'Q3 Video' }];
      videoCatalog.presets.push({ name: 'video_studio', task: 'video', model: 'pixverse/v6' });
      const { unexpected } = await fixture(page, baseURL, (request, url) => {
        if (url.pathname === '/api/admin/ai/models') return { body: videoCatalog };
        if (url.pathname === '/api/admin/ai/video-jobs') {
          creates += 1;
          return { status: 202, body: { ok: true, job: { jobId: 'q3-video-a', model: 'pixverse/v6', status: 'queued' } } };
        }
        if (url.pathname === '/api/admin/ai/video-jobs/q3-video-a') {
          reads += 1;
          return { body: { ok: true, job: { jobId: 'q3-video-a', model: 'pixverse/v6', status: 'failed', error: { message: 'Synthetic provider rejection' } } } };
        }
      });
      await page.clock.install();
      await page.locator('[data-ai-mode="video"]:visible').click();
      await page.locator('#aiVideoPrompt').fill('Synthetic video A');
      await page.locator('#aiVideoRun').click();
      await expect.poll(() => creates).toBe(1);
      await expect(page.locator('#aiLabStatus')).toContainText('Video job queued');
      await page.locator('[data-ai-mode="text"]:visible').click();
      await page.clock.runFor(10_000);
      expect(reads).toBe(0); expect(creates).toBe(1);
      await page.locator('[data-ai-mode="video"]:visible').click();
      await page.clock.runFor(3_000);
      await expect.poll(() => reads).toBe(1);
      await expect(page.locator('#aiVideoState')).toContainText('Synthetic provider rejection');
      await expect(page.locator('#aiVideoRun')).toBeEnabled();
      expect(creates).toBe(1); expect(unexpected).toEqual([]);
    });
    test('actual Fable workspace pauses AI video status reads and resumes the original job on close', async ({ page, baseURL }) => {
      const creates = []; const statusJobs = []; let fableLists = 0;
      const videoCatalog = structuredClone(catalog);
      videoCatalog.models.video = [{ id: 'pixverse/v6', task: 'video', label: 'Q3 Video' }];
      videoCatalog.presets.push({ name: 'video_studio', task: 'video', model: 'pixverse/v6' });
      const { unexpected, requests } = await fixture(page, baseURL, (request, url) => {
        if (url.pathname === '/api/admin/ai/models') return { body: videoCatalog };
        if (url.pathname === '/api/admin/fable-chat-data/overview') return { body: { ok: true, statistics: { activeConversations: 0, deletedConversations: 0, visibleMessages: 0 } } };
        if (url.pathname === '/api/admin/fable-chat-data/conversations') {
          fableLists += 1;
          return { body: { ok: true, conversations: [], total: 0 } };
        }
        if (url.pathname === '/api/admin/ai/video-jobs' && request.method() === 'POST') {
          creates.push(request.postDataJSON());
          return { status: 202, body: { ok: true, job: { jobId: 'q3-fable-video-a', model: 'pixverse/v6', status: 'queued' } } };
        }
        if (url.pathname === '/api/admin/ai/video-jobs/q3-fable-video-a' && request.method() === 'GET') {
          statusJobs.push(url.pathname);
          return { body: { ok: true, job: { jobId: 'q3-fable-video-a', model: 'pixverse/v6', status: 'failed', error: { message: 'Synthetic terminal status after Fable close' } } } };
        }
      });
      // The real admin entrypoint owns both controllers and their callbacks.
      // No direct controller invocation or replacement onOpen spy is used here.
      await expect(page.locator('#sectionAiLab')).toHaveAttribute('data-load-state', 'ready');
      expect(requests.some(entry => entry.path === '/api/admin/me')).toBe(true);
      await page.clock.install();
      await page.locator('[data-ai-mode="video"]:visible').click();
      await page.locator('#aiVideoPrompt').fill('Original video while inspecting Fable');
      await page.locator('#aiVideoRun').click();
      await expect.poll(() => creates.length).toBe(1);
      await expect(page.locator('#aiLabStatus')).toContainText('Video job queued');
      await page.locator('#fableDataOpen').click();
      await expect(page.locator('#fableDataWorkspace')).toBeVisible();
      await expect(page.locator('#fableDataStatus')).toContainText('0 conversations available');
      await expect(page.locator('#aiVideoPrompt')).not.toBeVisible();
      await page.clock.runFor(10_000);
      expect(statusJobs).toEqual([]);
      expect(creates).toHaveLength(1);
      expect(fableLists).toBe(1);
      await page.locator('#fableDataClose').press('Enter');
      await expect(page.locator('#fableDataWorkspace')).toBeHidden();
      await expect(page.locator('#aiVideoPrompt')).toHaveValue('Original video while inspecting Fable');
      await page.clock.runFor(3_000);
      await expect.poll(() => statusJobs.length).toBe(1);
      expect(statusJobs).toEqual(['/api/admin/ai/video-jobs/q3-fable-video-a']);
      await expect(page.locator('#aiVideoState')).toContainText('Synthetic terminal status after Fable close');
      await expect(page.locator('#aiVideoRun')).toBeEnabled();
      expect(creates).toHaveLength(1);
      expect(unexpected).toEqual([]);
    });
    for (const listOutcome of ['empty', 'unavailable']) {
      test(`image billing: ${listOutcome} organizations retain the specific state and block charged dispatch`, async ({ page, baseURL }) => {
        let recovered = false;
        const { unexpected, requests } = await fixture(page, baseURL, async (_request, url) => {
          if (url.pathname === '/api/admin/ai/models') return { body: { ...catalog, models: { ...catalog.models, image: [...catalog.models.image, { id: 'black-forest-labs/flux-2-max', label: 'Charged image', task: 'image' }] } } };
          if (url.pathname === '/api/admin/orgs') return recovered
            ? { body: { ok: true, organizations: [{ id: 'org_q3_a', name: 'Recovered organization' }] } }
            : listOutcome === 'empty' ? { body: { ok: true, organizations: [] } }
              : { status: 503, body: { ok: false, error: 'Organization list temporarily unavailable' } };
          if (url.pathname === '/api/admin/orgs/org_q3_a/billing') return { body: { ok: true, billing: { creditBalance: 9000 } } };
        });
        await page.locator('[data-ai-mode="image"]:visible').click();
        await page.locator('#aiImageModel').selectOption('black-forest-labs/flux-2-max');
        const expected = listOutcome === 'empty' ? 'No active organizations are available' : 'Organization list temporarily unavailable';
        await expect(page.locator('#aiImageOrganizationState')).toContainText(expected);
        await page.locator('#aiImagePrompt').fill('Synthetic image; no generation permitted');
        await page.locator('#aiImageRun').click();
        await expect(page.locator('#aiImageState')).toContainText('Select an organization before running this charged image test.');
        await expect(page.locator('#aiImageOrganizationState')).toContainText(expected);
        expect(requests.filter(row => row.method === 'POST')).toEqual([]);
        recovered = true;
        await page.reload();
        await expect(page.locator('#aiImageOrganizationState')).toContainText('Recovered organization');
        await expect(page.locator('#aiImageOrganizationState')).toContainText('9000');
        await expect(page.locator('#aiImageOrganizationState')).not.toContainText(expected);
        expect(unexpected).toEqual([]);
      });
    }
    for (const oldOutcome of ['success', 'error']) {
      test(`image billing: late A ${oldOutcome} cannot replace B balance; failed B recovers`, async ({ page, baseURL }) => {
        const old = deferred(); let requestedA = 0; let requestedB = 0; let failB = false;
        const { unexpected } = await fixture(page, baseURL, async (_request, url) => {
          if (url.pathname === '/api/admin/orgs') return { body: { ok: true, organizations: [{ id: 'org_q3_a', name: 'Organization A' }, { id: 'org_q3_b', name: 'Organization B' }] } };
          if (url.pathname === '/api/admin/orgs/org_q3_a/billing') {
            requestedA += 1;
            if (requestedA === 1) await old.promise;
            return oldOutcome === 'error' && requestedA === 1 ? { status: 503, body: { ok: false, error: 'Old A unavailable' } } : { body: { ok: true, billing: { creditBalance: 111 } } };
          }
          if (url.pathname === '/api/admin/orgs/org_q3_b/billing') {
            requestedB += 1;
            return failB ? { status: 503, body: { ok: false, error: 'Current B unavailable' } } : { body: { ok: true, billing: { creditBalance: 777 } } };
          }
        });
        await page.locator('[data-ai-mode="image"]:visible').click();
        await page.locator('#aiImageModel').selectOption('@cf/black-forest-labs/flux-1-schnell');
        await expect.poll(() => requestedA).toBe(1);
        await page.locator('#aiImageOrganization').selectOption('org_q3_b');
        await expect(page.locator('#aiImageOrganizationState')).toContainText('777');
        const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/orgs/org_q3_a/billing');
        old.resolve();
        await (await oldResponse).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        await expect(page.locator('#aiImageOrganizationState')).toContainText('Organization B');
        await expect(page.locator('#aiImageOrganizationState')).toContainText('777');
        await expect(page.locator('#aiImageOrganizationState')).not.toContainText('111');
        failB = true;
        await page.locator('#aiImageOrganization').selectOption('org_q3_b');
        await expect(page.locator('#aiImageOrganizationState')).toContainText('Current B unavailable');
        failB = false;
        await page.locator('#aiImageOrganization').selectOption('org_q3_b');
        await expect(page.locator('#aiImageOrganizationState')).toContainText('777');
        expect(unexpected).toEqual([]);
      });
    }
    for (const outcome of ['unknown', 'rejected']) {
      test(`${outcome} save: reopen retains original intent; only confirmed rejection can retry`, async ({ page, baseURL }) => {
        const saves = [];
        const { unexpected } = await fixture(page, baseURL, (request, url) => {
          if (url.pathname === '/api/admin/ai/test-text') return { body: responseFor('text', request.postDataJSON()) };
          if (url.pathname === '/api/admin/ai/save-text-asset') {
            saves.push(request.postDataJSON());
            if (saves.length > 1) return { status: 201, body: { ok: true, data: { id: 'a' } } };
            return outcome === 'unknown' ? { abort: true } : { status: 429, body: { ok: false, code: 'rate_limited', error: 'Try later' } };
          }
        });
        await generate(page, 'text');
        await page.locator('#aiTextSave').click();
        await expect(page.locator('#aiLabSaveState')).toContainText('Choose a folder');
        await page.locator('#aiLabSaveFolder').selectOption('folder-a');
        await page.locator('#aiLabSaveConfirm').click();
        await expect(page.locator('#aiLabSaveState')).toContainText(outcome === 'unknown' ? 'Outcome unknown' : 'Retry keeps');
        await page.locator('#aiLabSaveCancel').click();
        await page.locator('#aiTextPrompt').fill('B edited afterwards');
        await page.locator('#aiTextSave').click();
        await expect(page.locator('#aiLabSaveInput')).toHaveValue('Prompt A');
        await expect(page.locator('#aiLabSaveFolder')).toHaveValue('folder-a');
        if (outcome === 'unknown') {
          await expect(page.locator('#aiLabSaveConfirm')).toBeDisabled();
          await page.locator('#aiLabSaveConfirm').evaluate(el => el.click());
          expect(saves).toHaveLength(1);
        } else {
          await expect(page.locator('#aiLabSaveConfirm')).toHaveText('Retry this save');
          await page.locator('#aiLabSaveConfirm').press('Enter');
          await expect(page.locator('#aiLabSaveModal')).toBeHidden();
          expect(saves).toHaveLength(2); expect(saves[1]).toEqual(saves[0]);
        }
        expect(unexpected).toEqual([]);
      });
    }
  });
}
