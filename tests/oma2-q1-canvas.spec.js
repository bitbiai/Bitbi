const { test, expect } = require('@playwright/test');
test.use({ viewport: { width: 1440, height: 1000 } });

// Frontend-only fixture. Every API request is intercepted; remote resources
// are aborted. PATCH deliberately replaces whole top-level values, matching
// the Canvas contract rather than hiding lost updates with a deep merge.
const PROJECT_A = '1'.repeat(32);
const PROJECT_B = 'a'.repeat(32);
const NODE_A = '2'.repeat(32);
const NODE_B = '3'.repeat(32);
const GENERATOR = '4'.repeat(32);
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(page, baseURL) {
  const projects = [
    { id: PROJECT_A, title: 'Project A', locale: 'en', thumbnail_asset_id: null },
    { id: PROJECT_B, title: 'Project B', locale: 'de', thumbnail_asset_id: null },
  ].map((project) => ({ ...project, created_at: '2026-09-06T00:00:00.000Z', updated_at: '2026-09-06T00:00:00.000Z' }));
  const node = (id, title, x, type = 'note') => ({
    id, project_id: PROJECT_A, type, title, x, y: 80, width: null, height: null,
    model_id: type === 'text_generation' ? 'synthetic-text' : null,
    config: type === 'text_generation' ? { prompt: 'Initial prompt', maxTokens: 500, temperature: 0.7 } : {},
    content: { text: 'Initial text' }, output: null, asset_id: null,
  });
  const nodes = [node(NODE_A, 'Node A', 50), node(NODE_B, 'Node B', 320), node(GENERATOR, 'Generator', 590, 'text_generation')];
  const state = { projects, nodes, edges: [], creates: [], patches: [], requests: [], runs: [], failNodes: new Set(), active: new Map(), maxActive: new Map(), unexpected: [] };
  const holds = [];
  const postHolds = [];
  state.holdNext = (id, options = {}) => {
    const reached = deferred();
    const released = deferred();
    holds.push({ id, options, reached, released });
    return { reached: reached.promise, release: () => released.resolve() };
  };
  state.holdNextPost = (kind) => {
    const reached = deferred();
    const released = deferred();
    postHolds.push({ kind, reached, released });
    return { reached: reached.promise, release: () => released.resolve() };
  };
  const fulfill = (route, data, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, code: 'synthetic_save_failure', error: 'Synthetic save failure' }),
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = request.method();
    const pathname = url.pathname;
    state.requests.push({ method, pathname });
    if (pathname === '/api/me') return route.fulfill({ json: { loggedIn: true, user: { id: 'synthetic-canvas-member', email: 'canvas@example.invalid', role: 'user' } } });
    if (pathname === '/api/wallet/status') return route.fulfill({ json: { ok: true, linked: false } });
    if (pathname === '/api/account/credits-dashboard') return fulfill(route, { dashboard: { balance: { totalCredits: 500 } } });
    const base = '/api/account/canvas';
    if (pathname === `${base}/models`) return fulfill(route, {
      models: [
        { id: 'synthetic-text', label: 'Synthetic text', capability: 'text', runnable: true, estimatedCredits: 1, controls: { maxPromptLength: 12000, maxTokens: { max: 4096, default: 500 } } },
        { id: 'synthetic-image', label: 'Synthetic image', capability: 'image', runnable: true, controls: {} },
        { id: 'synthetic-video', label: 'Synthetic video', capability: 'video', runnable: true, controls: { supportsImageInput: true } },
      ],
      organizations: [], access: { role: 'user' },
    });
    if (pathname === `${base}/projects` && method === 'GET') return fulfill(route, { projects });
    const projectMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})$/);
    const nodeMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes\/([a-f0-9]{32})$/);
    const runMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/nodes\/([a-f0-9]{32})\/run$/);
    const createMatch = pathname.match(/^\/api\/account\/canvas\/projects\/([a-f0-9]{32})\/(nodes|edges)$/);
    if (projectMatch && method === 'GET') return fulfill(route, {
      project: projects.find((item) => item.id === projectMatch[1]),
      nodes: nodes.filter((item) => item.project_id === projectMatch[1]), edges: state.edges.filter((item) => item.project_id === projectMatch[1]), runs: [],
    });
    if (createMatch && method === 'POST') {
      const kind = createMatch[2];
      const created = { id: (state.creates.length + 10).toString(16).padStart(32, '0'), project_id: createMatch[1], ...request.postDataJSON() };
      if (kind === 'nodes') Object.assign(created, { width: null, height: null, output: null, asset_id: null });
      state[kind].push(created);
      const record = { kind, projectId: createMatch[1], created: clone(created), replied: false };
      state.creates.push(record);
      const index = postHolds.findIndex((hold) => hold.kind === kind);
      const hold = index >= 0 ? postHolds.splice(index, 1)[0] : null;
      if (hold) { hold.reached.resolve(record); await hold.released.promise; }
      record.replied = true;
      return fulfill(route, kind === 'nodes' ? { node: record.created } : { edge: record.created }, 201);
    }
    if ((projectMatch || nodeMatch) && method === 'PATCH') {
      const projectId = (projectMatch || nodeMatch)[1];
      const id = nodeMatch ? nodeMatch[2] : projectId;
      const target = nodeMatch ? nodes.find((item) => item.project_id === projectId && item.id === id) : projects.find((item) => item.id === id);
      const key = `${projectId}/${id}`;
      const body = request.postDataJSON();
      const record = { projectId, id, body: clone(body) };
      state.patches.push(record);
      const active = (state.active.get(key) || 0) + 1;
      state.active.set(key, active);
      state.maxActive.set(key, Math.max(active, state.maxActive.get(key) || 0));
      const index = holds.findIndex((hold) => hold.id === id);
      const hold = index >= 0 ? holds.splice(index, 1)[0] : null;
      const failed = state.failNodes.has(id);
      if (!failed) Object.assign(target, clone(body), { updated_at: new Date(Date.UTC(2026, 8, 6, 0, 0, state.patches.length)).toISOString() });
      // Capture the full reply now: holding it must expose stale-reply races.
      const reply = clone(target);
      if (hold) { hold.reached.resolve(record); await hold.released.promise; }
      state.active.set(key, active - 1);
      if (hold?.options.loseReply) return route.abort('failed');
      if (hold?.options.malformed) return route.fulfill({ json: { ok: true, data: {} } });
      return fulfill(route, nodeMatch ? { node: reply } : { project: reply }, failed ? 503 : 200);
    }
    if (runMatch && method === 'POST') {
      const savedNode = clone(nodes.find((item) => item.id === runMatch[2]));
      const run = { id: `synthetic-run-${state.runs.length}`, node_id: savedNode.id, status: 'succeeded', output: { kind: 'text', text: 'Synthetic output' } };
      state.runs.push({ savedNode, project: clone(projects.find((item) => item.id === runMatch[1])), run });
      return fulfill(route, { run });
    }
    state.unexpected.push({ method, pathname });
    return fulfill(route, {}, 404);
  });
  return state;
}

const card = (page, id) => page.locator(`.canvas-node[data-node-id="${id}"]`);
// The accessible button name also contains its localized updated-at date.
const projectButton = (page, title) => page.locator('.canvas-project-item__open').filter({ has: page.getByText(title, { exact: true }) });
const inspector = (page) => page.locator('#canvasInspectorBody');
const saved = (page) => expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'saved');
const findNode = (state, id) => state.nodes.find((node) => node.id === id);
async function open(page, locale) {
  await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
  await expect(card(page, NODE_A)).toBeVisible();
  await expect(page.locator('#canvasApp')).toHaveJSProperty('inert', false);
}

for (const locale of ['en', 'de']) {
  const labels = locale === 'de'
    ? { title: 'Titel', text: 'Text', tokens: 'Max. Tokens', run: 'Ausführen' }
    : { title: 'Title', text: 'Text', tokens: 'Max tokens', run: 'Run' };

  test(`P13 ${locale}: rapid same/different nodes, content/config/title/move survive reload`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    // One browser turn guarantees all real DOM input/keyboard handlers run
    // inside the unmodified debounce window, independent of host load.
    await page.evaluate(({ a, b, generator }) => {
      const select = (id) => document.querySelector(`[data-node-id="${id}"]`).click();
      const input = (selector, value) => {
        const control = document.querySelector(`#canvasInspectorBody ${selector}`);
        control.value = value; control.dispatchEvent(new Event('input', { bubbles: true }));
      };
      select(a); input('input', 'Changed A'); input('textarea', 'Changed content');
      document.querySelector(`[data-node-id="${a}"]`).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      select(b); input('input', 'Changed B');
      select(generator); input('input', 'Changed generator'); input('textarea', 'Changed prompt');
      input('input[type="number"]', '700');
    }, { a: NODE_A, b: NODE_B, generator: GENERATOR });
    await expect.poll(() => state.patches.length).toBe(3);
    await saved(page);
    expect(findNode(state, NODE_A)).toMatchObject({ title: 'Changed A', content: { text: 'Changed content' }, x: 60, y: 80 });
    expect(findNode(state, NODE_B).title).toBe('Changed B');
    expect(findNode(state, GENERATOR)).toMatchObject({ title: 'Changed generator', config: { prompt: 'Changed prompt', maxTokens: 700, temperature: 0.7 } });
    expect(state.patches.find((patch) => patch.id === NODE_A).body).toEqual({ title: 'Changed A', content: { text: 'Changed content' }, x: 60, y: 80 });
    await page.reload();
    await expect(card(page, NODE_A)).toContainText('Changed A');
    await expect(card(page, NODE_B)).toContainText('Changed B');
    await card(page, NODE_A).click();
    await expect(inspector(page).getByLabel(labels.text, { exact: true })).toHaveValue('Changed content');
    await card(page, GENERATOR).click();
    await expect(inspector(page).getByLabel('Prompt', { exact: true })).toHaveValue('Changed prompt');
    await expect(inspector(page).getByLabel(labels.tokens, { exact: true })).toHaveValue('700');
    expect(state.unexpected).toEqual([]);
  });

  test(`P13 ${locale}: sequential positive control with real focus and keyboard movement`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    await card(page, NODE_A).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Sequential A');
    await saved(page);
    await card(page, NODE_A).press('ArrowDown');
    await saved(page);
    await expect(card(page, NODE_A)).toBeFocused();
    await card(page, NODE_B).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Sequential B');
    await saved(page);
    await page.reload();
    await expect(card(page, NODE_A)).toContainText('Sequential A');
    await expect(card(page, NODE_B)).toContainText('Sequential B');
    expect(findNode(state, NODE_A).y).toBe(90);
  });

  test(`P13 ${locale}: real pointer drag survives an older edit reply during pointer capture`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    const edit = state.holdNext(NODE_A);
    await card(page, NODE_A).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Edited and dragged');
    await edit.reached;
    const head = await card(page, NODE_A).locator('.canvas-node__head').boundingBox();
    await page.mouse.move(head.x + 70, head.y + 20);
    await page.mouse.down();
    await page.mouse.move(head.x + 110, head.y + 50, { steps: 4 });
    const response = page.waitForResponse((reply) => reply.request().method() === 'PATCH' && reply.url().includes(NODE_A));
    edit.release();
    await response;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(card(page, NODE_A)).toHaveClass(/is-dragging/);
    await page.mouse.move(head.x + 160, head.y + 80, { steps: 4 });
    await page.mouse.up();
    await saved(page);
    expect(findNode(state, NODE_A)).toMatchObject({ title: 'Edited and dragged', x: 140, y: 140 });
    expect(state.patches.find((patch) => Object.hasOwn(patch.body, 'x')).body).toEqual({ x: 140, y: 140 });
    await page.reload();
    await expect(card(page, NODE_A)).toContainText('Edited and dragged');
    expect(await card(page, NODE_A).evaluate((node) => {
      const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { x: transform.m41, y: transform.m42 };
    })).toEqual({ x: 140, y: 140 });
  });

  for (const action of ['node', 'connection', 'quick workflow']) {
    test(`P13 ${locale}: delayed ${action} POST stays with its project after switching`, async ({ page, baseURL }) => {
      const state = await fixture(page, baseURL);
      await open(page, locale);
      const kind = action === 'connection' ? 'edges' : 'nodes';
      const delayed = state.holdNextPost(kind);
      if (action === 'node') {
        await page.locator('#canvasNodeType').selectOption('note');
        await page.locator('#canvasAddNode').click();
      } else if (action === 'connection') {
        await card(page, NODE_A).locator('[data-port="out"]').click();
        await card(page, NODE_B).locator('[data-port="in"]').click();
      } else await page.locator('#canvasQuickTextImageVideo').click();
      const first = await delayed.reached;
      await projectButton(page, 'Project B').click();
      await expect(page.locator('#canvasProjectTitle')).toHaveValue('Project B');
      const response = page.waitForResponse((reply) => reply.request().method() === 'POST' && reply.url().endsWith(`/${kind}`));
      delayed.release();
      await response;
      await expect.poll(() => state.creates.filter((item) => item.replied).length).toBe(action === 'quick workflow' ? 5 : 1);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#canvasProjectTitle')).toHaveValue('Project B');
      await expect(page.locator('.canvas-node')).toHaveCount(0);
      await expect(page.locator('[data-edge-id]')).toHaveCount(0);
      expect(state.creates.every((item) => item.projectId === PROJECT_A)).toBe(true);
      await projectButton(page, 'Project A').click();
      if (kind === 'nodes') await expect(card(page, first.created.id)).toBeVisible();
      else await expect(page.locator(`[data-edge-id="${first.created.id}"]`)).toHaveCount(1);
      await expect(page.locator('.canvas-node')).toHaveCount(action === 'node' ? 4 : action === 'quick workflow' ? 6 : 3);
      await expect(page.locator('[data-edge-id]')).toHaveCount(action === 'connection' ? 1 : action === 'quick workflow' ? 2 : 0);
    });
  }

  test(`P13 ${locale}: existing narrow viewport guidance and desktop layout remain available`, async ({ page, baseURL }) => {
    await fixture(page, baseURL);
    await open(page, locale);
    await expect(page.locator('.canvas-mobile-note')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.canvas-mobile-note')).toBeVisible();
    await expect(page.locator('.canvas-mobile-note')).toContainText(locale === 'de' ? 'Desktop oder Tablet' : 'desktop or tablet');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('.canvas-mobile-note')).toBeHidden();
    await expect(card(page, NODE_A)).toBeVisible();
  });

  test(`P13 ${locale}: edits during slow save serialize, switch waits for both replies`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    const first = state.holdNext(NODE_A);
    await card(page, NODE_A).click();
    await inspector(page).getByLabel(labels.text, { exact: true }).fill('First content');
    await first.reached;
    const second = state.holdNext(NODE_A);
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Latest title');
    await inspector(page).getByLabel(labels.text, { exact: true }).fill('Latest content');
    await card(page, NODE_B).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Independent B');
    await expect.poll(() => findNode(state, NODE_B).title).toBe('Independent B');
    expect(state.patches.filter((patch) => patch.id === NODE_A)).toHaveLength(1);
    await projectButton(page, 'Project B').click();
    await expect(page.locator('#canvasApp')).toHaveJSProperty('inert', true);
    const getB = () => state.requests.filter((request) => request.method === 'GET' && request.pathname.endsWith(`/projects/${PROJECT_B}`));
    expect(getB()).toHaveLength(0);
    first.release();
    const secondPatch = await second.reached;
    expect(secondPatch.body).toEqual({ title: 'Latest title', content: { text: 'Latest content' } });
    expect(getB()).toHaveLength(0);
    await expect(card(page, NODE_A)).toContainText('Latest title');
    second.release();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Project B');
    await projectButton(page, 'Project A').click();
    await expect(card(page, NODE_A)).toContainText('Latest title');
    await card(page, NODE_A).click();
    await expect(inspector(page).getByLabel(labels.text, { exact: true })).toHaveValue('Latest content');
    expect(state.maxActive.get(`${PROJECT_A}/${NODE_A}`)).toBe(1);
  });

  test(`P13 ${locale}: failure remains through unrelated success, blocks switch/run, retries original identity`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    state.failNodes.add(NODE_A);
    await card(page, NODE_A).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Retained after failure');
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'error');
    await card(page, NODE_B).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Successful B');
    await expect.poll(() => findNode(state, NODE_B).title).toBe('Successful B');
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'error');
    await projectButton(page, 'Project B').click();
    await expect(page.locator('#canvasApp')).toHaveJSProperty('inert', false);
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Project A');
    expect(state.requests.some((request) => request.method === 'GET' && request.pathname.endsWith(`/projects/${PROJECT_B}`))).toBe(false);
    await card(page, GENERATOR).click();
    await inspector(page).getByRole('button', { name: labels.run, exact: true }).click();
    await expect(page.locator('#canvasApp')).toHaveJSProperty('inert', false);
    expect(state.runs).toHaveLength(0);
    // Test the actual unload listener, without claiming browser exit can await
    // a save or guarantee persistence. Failed-only state must still warn.
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
    state.failNodes.delete(NODE_A);
    await page.locator('#canvasRetrySave').click();
    await saved(page);
    expect(findNode(state, NODE_A).title).toBe('Retained after failure');
    await page.reload();
    await expect(card(page, NODE_A)).toContainText('Retained after failure');
    await expect(card(page, NODE_B)).toContainText('Successful B');
  });

  test(`P13 ${locale}: run flushes project and node inflight; stale project reply preserves new title`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    const firstProject = state.holdNext(PROJECT_A);
    await page.locator('#canvasProjectTitle').fill('First project title');
    await firstProject.reached;
    const secondProject = state.holdNext(PROJECT_A);
    await page.locator('#canvasProjectTitle').fill('Latest project title');
    const nodeRequest = state.holdNext(GENERATOR);
    await card(page, GENERATOR).click();
    await inspector(page).getByLabel('Prompt', { exact: true }).fill('Prompt for saved run');
    await nodeRequest.reached;
    await inspector(page).getByRole('button', { name: labels.run, exact: true }).click();
    await expect(page.locator('#canvasApp')).toHaveJSProperty('inert', true);
    expect(state.runs).toHaveLength(0);
    firstProject.release();
    expect((await secondProject.reached).body).toEqual({ title: 'Latest project title' });
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Latest project title');
    nodeRequest.release();
    expect(state.runs).toHaveLength(0);
    secondProject.release();
    await expect.poll(() => state.runs.length).toBe(1);
    expect(state.runs[0].savedNode.config.prompt).toBe('Prompt for saved run');
    expect(state.runs[0].project.title).toBe('Latest project title');
    await saved(page);
    await expect(inspector(page)).toContainText('Synthetic output');
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    await page.reload();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Latest project title');
  });

  test(`P13 ${locale}: response loss keeps uncertainty visible until retry confirmation`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    const lost = state.holdNext(NODE_A, { loseReply: true });
    await card(page, NODE_A).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Committed but reply lost');
    await lost.reached;
    expect(findNode(state, NODE_A).title).toBe('Committed but reply lost');
    lost.release();
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'error');
    await page.locator('#canvasRetrySave').click();
    await saved(page);
    expect(state.patches.filter((patch) => patch.id === NODE_A).map((patch) => patch.body)).toEqual([
      { title: 'Committed but reply lost' }, { title: 'Committed but reply lost' },
    ]);
    await page.reload();
    await expect(card(page, NODE_A)).toContainText('Committed but reply lost');
  });

  test(`P13 ${locale}: newer edit retries failed fields together; malformed success still requires confirmation`, async ({ page, baseURL }) => {
    const state = await fixture(page, baseURL);
    await open(page, locale);
    state.failNodes.add(NODE_A);
    const failed = state.holdNext(NODE_A);
    await card(page, NODE_A).click();
    await inspector(page).getByLabel(labels.title, { exact: true }).fill('Failed title');
    await failed.reached;
    await inspector(page).getByLabel(labels.text, { exact: true }).fill('Newer content');
    const malformed = state.holdNext(NODE_A, { malformed: true });
    state.failNodes.delete(NODE_A);
    failed.release();
    expect((await malformed.reached).body).toEqual({ title: 'Failed title', content: { text: 'Newer content' } });
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'error');
    malformed.release();
    await expect(page.locator('#canvasRetrySave')).toBeEnabled();
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'error');
    await page.locator('#canvasRetrySave').click();
    await saved(page);
    expect(state.patches.filter((patch) => patch.id === NODE_A)).toHaveLength(3);
    await page.reload();
    await card(page, NODE_A).click();
    await expect(inspector(page).getByLabel(labels.title, { exact: true })).toHaveValue('Failed title');
    await expect(inspector(page).getByLabel(labels.text, { exact: true })).toHaveValue('Newer content');
  });
}

test('P13 coordinator: shallow replacement, snapshots, identity isolation, thrown failure and complete drain', async ({ page, baseURL }) => {
  await fixture(page, baseURL);
  await open(page, 'en');
  const actual = await page.evaluate(async () => {
    const { createCanvasSaveQueue } = await import('/js/pages/canvas/state.js?v=__ASSET_VERSION__');
    const sent = [];
    let failing = true;
    const queue = createCanvasSaveQueue({ delay: 60000, save: async (...args) => {
      sent.push(args);
      if (args[1] === 'fails' && failing) throw new Error('Synthetic throw');
      return { ok: true };
    } });
    const original = { config: { values: [1], discard: true }, content: { items: [5] }, asset_id: 'old' };
    queue.schedule('project-a', 'same-node', original);
    original.config.values.push(99);
    original.content.items.push(99);
    queue.schedule('project-a', 'same-node', { title: 'Title', config: { values: [2] }, asset_id: null });
    queue.schedule('project-b', 'same-node', { content: { items: [3] } });
    const merged = await queue.flush();
    queue.schedule('project-a', 'fails', { title: 'Retained' });
    const failed = await queue.flush();
    queue.schedule('project-b', 'same-node', { x: 42 });
    await queue.flush('project-b');
    const afterOther = { ...queue.status, dirty: queue.dirty };
    failing = false;
    const retried = await queue.flush();

    let releaseFirst; let releaseSecond; let startedFirst; let startedSecond;
    const firstStarted = new Promise((resolve) => { startedFirst = resolve; });
    const secondStarted = new Promise((resolve) => { startedSecond = resolve; });
    let calls = 0;
    const draining = createCanvasSaveQueue({ delay: 60000, save: async () => {
      calls += 1;
      if (calls === 1) { startedFirst(); return new Promise((resolve) => { releaseFirst = resolve; }); }
      startedSecond(); return new Promise((resolve) => { releaseSecond = resolve; });
    } });
    draining.schedule('project', 'node', { title: 'First' });
    let flushFinished = false;
    const flush = draining.flush().then((ok) => { flushFinished = true; return ok; });
    await firstStarted;
    draining.schedule('project', 'node', { content: { text: 'During save' } });
    const during = { ...draining.status, flushFinished, dirty: draining.dirty };
    releaseFirst({ ok: true });
    await secondStarted;
    const afterFirst = { ...draining.status, flushFinished };
    releaseSecond({ ok: true });
    const callbackFailure = createCanvasSaveQueue({
      save: async () => ({ ok: true }), onConfirm: () => { throw new Error('Synthetic invalid confirmation'); },
    });
    callbackFailure.schedule('project', 'node', { title: 'Still unconfirmed' });
    const invalidConfirmation = await callbackFailure.flush();
    return { sent, merged, failed, afterOther, retried, status: queue.status, during, afterFirst, drained: await flush, finalDirty: draining.dirty,
      invalidConfirmation, invalidStatus: callbackFailure.status, invalidDirty: callbackFailure.dirty };
  });
  expect(actual.sent[0]).toEqual(['project-a', 'same-node', { config: { values: [2] }, content: { items: [5] }, asset_id: null, title: 'Title' }]);
  expect(actual.sent[1]).toEqual(['project-b', 'same-node', { content: { items: [3] } }]);
  expect(actual.merged).toBe(true);
  expect(actual.failed).toBe(false);
  expect(actual.afterOther).toMatchObject({ failed: 1, dirty: true });
  expect(actual.sent.at(-1)).toEqual(['project-a', 'fails', { title: 'Retained' }]);
  expect(actual.retried).toBe(true);
  expect(actual.status).toMatchObject({ pending: 0, inflight: 0, failed: 0 });
  expect(actual.during).toMatchObject({ pending: 1, inflight: 1, confirmed: 0, dirty: true, flushFinished: false });
  expect(actual.afterFirst).toMatchObject({ inflight: 1, confirmed: 1, flushFinished: false });
  expect(actual.drained).toBe(true);
  expect(actual.finalDirty).toBe(false);
  expect(actual.invalidConfirmation).toBe(false);
  expect(actual.invalidStatus).toMatchObject({ failed: 1, confirmed: 0 });
  expect(actual.invalidDirty).toBe(true);
});
