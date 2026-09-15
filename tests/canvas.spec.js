const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

async function mockSharedAuth(page, loggedIn = true) {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(loggedIn
      ? { loggedIn: true, user: { id: 'canvas-member', email: 'canvas@example.com', role: 'user' } }
      : { loggedIn: false, user: null }),
  }));
}

function createCanvasApiMock(page, { authenticated = true } = {}) {
  const projectId = '11111111111111111111111111111111';
  const state = { projects: [], nodes: [], edges: [], runs: [], modelRequests: 0, requests: [] };
  const imageModel = {
    id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell', vendor: 'Cloudflare', capability: 'image',
    description: 'Fast image model.', outputType: 'image', canvasEnabled: true, runnable: true, disabledReason: null,
    pricingStatus: 'member_credit_priced', estimatedCredits: 1, controls: { maxPromptLength: 1000 },
  };
  const textModel = { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama', capability: 'text', description: 'Text model.', runnable: true, estimatedCredits: 1, pricingStatus: 'fixed_member_credit', controls: { maxPromptLength: 12000, maxTokens: { min: 1, max: 4096, default: 500 } } };
  const videoModel = { id: 'pixverse/v6', label: 'PixVerse V6', capability: 'video', description: 'Video model.', runnable: true, estimatedCredits: 20, pricingStatus: 'member_credit_priced', controls: { maxPromptLength: 5000, supportsImageInput: true, duration: { min: 5, max: 10, default: 5 }, defaultAspectRatio: '16:9' } };
  const fulfill = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { ok: true, data } : data) });

  page.route('**/api/account/canvas/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push({ method, pathname });
    if (!authenticated) return fulfill(route, { ok: false, error: 'Authentication required.', code: 'unauthorized' }, 401);
    if (pathname.endsWith('/models')) { state.modelRequests += 1; return fulfill(route, { models: [textModel, imageModel, videoModel], organizations: [], selected_organization_id: null, access: { role: 'user', is_admin: false } }); }
    if (pathname === '/api/account/canvas/projects' && method === 'GET') return fulfill(route, { projects: state.projects, applied_limit: 50 });
    if (pathname === '/api/account/canvas/projects' && method === 'POST') {
      const body = request.postDataJSON();
      const now = new Date().toISOString();
      const project = { id: projectId, title: body.title, locale: body.locale, thumbnail_asset_id: null, created_at: now, updated_at: now };
      state.projects = [project];
      return fulfill(route, { project }, 201);
    }
    if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'GET') return fulfill(route, { project: state.projects[0], nodes: state.nodes, edges: state.edges, runs: state.runs });
    if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'PATCH') {
      Object.assign(state.projects[0], request.postDataJSON(), { updated_at: new Date().toISOString() });
      return fulfill(route, { project: state.projects[0] });
    }
    if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'DELETE' && state.projects.some((project) => project.id === projectId)) {
      state.projects = state.projects.filter((project) => project.id !== projectId);
      state.nodes = state.nodes.filter((node) => node.project_id !== projectId);
      state.edges = state.edges.filter((edge) => edge.project_id !== projectId);
      state.runs = state.runs.filter((run) => run.project_id !== projectId);
      return fulfill(route, { id: projectId, deleted: true, assets_deleted: false });
    }
    if (pathname === `/api/account/canvas/projects/${projectId}/nodes` && method === 'POST') {
      const body = request.postDataJSON();
      const node = { id: String(state.nodes.length + 2).repeat(32).slice(0, 32), project_id: projectId, ...body, width: null, height: null, output: null, asset_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.nodes.push(node);
      return fulfill(route, { node }, 201);
    }
    const nodeMatch = pathname.match(/\/nodes\/([a-f0-9]{32})$/);
    if (nodeMatch && method === 'PATCH') {
      const node = state.nodes.find((item) => item.id === nodeMatch[1]);
      Object.assign(node, request.postDataJSON(), { updated_at: new Date().toISOString() });
      return fulfill(route, { node });
    }
    if (nodeMatch && method === 'DELETE' && pathname === `/api/account/canvas/projects/${projectId}/nodes/${nodeMatch[1]}` && state.nodes.some((node) => node.id === nodeMatch[1] && node.project_id === projectId)) {
      state.nodes = state.nodes.filter((node) => node.id !== nodeMatch[1]);
      state.edges = state.edges.filter((edge) => edge.source_node_id !== nodeMatch[1] && edge.target_node_id !== nodeMatch[1]);
      return fulfill(route, { id: nodeMatch[1], deleted: true, asset_deleted: false });
    }
    if (pathname === `/api/account/canvas/projects/${projectId}/edges` && method === 'POST') {
      const body = request.postDataJSON();
      const edge = { id: String.fromCharCode(101 + state.edges.length).repeat(32), project_id: projectId, ...body, label: null, config: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.edges.push(edge);
      return fulfill(route, { edge }, 201);
    }
    const edgeMatch = pathname.match(/\/edges\/([a-f0-9]{32})$/);
    if (edgeMatch && method === 'DELETE' && pathname === `/api/account/canvas/projects/${projectId}/edges/${edgeMatch[1]}` && state.edges.some((edge) => edge.id === edgeMatch[1] && edge.project_id === projectId)) {
      state.edges = state.edges.filter((edge) => edge.id !== edgeMatch[1]);
      return fulfill(route, { id: edgeMatch[1], deleted: true });
    }
    return fulfill(route, { ok: false, error: 'Not mocked', code: 'not_mocked' }, 404);
  });
  page.route('**/api/account/credits-dashboard**', (route) => fulfill(route, { dashboard: { balance: { totalCredits: 500 } } }));
  return state;
}

test.describe('BITBI Canvas static and protected workspace', () => {
  test('English and German pages keep noindex, canonical, hreflang, and navigation parity', () => {
    const en = source('canvas/index.html');
    const de = source('de/canvas/index.html');
    expect(en).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(de).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(en).toContain('<link rel="canonical" href="https://bitbi.ai/canvas/">');
    expect(de).toContain('<link rel="canonical" href="https://bitbi.ai/de/canvas/">');
    for (const html of [en, de]) {
      expect(html).toContain('hreflang="en" href="https://bitbi.ai/canvas/"');
      expect(html).toContain('hreflang="de" href="https://bitbi.ai/de/canvas/"');
      const generateHref = html.includes('href="/de/generate-lab/"') ? 'href="/de/generate-lab/"' : 'href="/generate-lab/"';
      const canvasHref = html.includes('href="/de/canvas/" class="mobile-nav') ? 'href="/de/canvas/" class="mobile-nav' : 'href="/canvas/" class="mobile-nav';
      expect(html.indexOf(generateHref)).toBeLessThan(html.indexOf(canvasHref));
      expect(html).not.toContain('/api/admin/');
    }
    expect(source('index.html')).toContain('href="/canvas/" class="hero__canvas-teaser"');
    expect(source('de/index.html')).toContain('href="/de/canvas/" class="hero__canvas-teaser"');
  });

  test('logged-out Canvas reveals only the login-required gate and never requests models', async ({ page }) => {
    await mockSharedAuth(page, false);
    const state = createCanvasApiMock(page, { authenticated: false });
    await page.goto('/canvas/');
    await expect(page.getByRole('heading', { name: 'Sign in to use Canvas' })).toBeVisible();
    await expect(page.locator('#canvasApp')).toBeHidden();
    await expect(page.locator('#canvasProjectList')).toBeHidden();
    expect(state.modelRequests).toBe(0);
  });

  test('authenticated member can create a project, add nodes, connect them, and reload persisted graph state', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    await page.goto('/canvas/');
    await expect(page.locator('#canvasApp')).toBeVisible();
    await expect(page.locator('header .site-nav__links').getByRole('link', { name: 'Generate Lab' })).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('header .site-nav__links').getByText('Canvas', { exact: true })).toHaveAttribute('aria-current', 'page');
    page.once('dialog', (dialog) => dialog.accept('Campaign workflow'));
    await page.locator('#canvasNewProject').click();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Campaign workflow');

    await page.locator('#canvasNodeType').selectOption('text_prompt');
    await page.locator('#canvasAddNode').click();
    await page.locator('#canvasNodeType').selectOption('image_generation');
    await page.locator('#canvasAddNode').click();
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('#canvasEmpty')).toBeHidden();

    await page.locator('.canvas-node').nth(0).locator('[data-port="out"]').click();
    await page.locator('.canvas-node').nth(1).locator('[data-port="in"]').click();
    await expect.poll(() => state.edges.length).toBe(1);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    await expect(page.locator('#canvasNodes')).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('.canvas-node').first()).toHaveCSS('pointer-events', 'auto');

    const sourceId = state.nodes[0].id;
    const start = { x: state.nodes[0].x, y: state.nodes[0].y };
    const pathBefore = await page.locator('.canvas-edge').getAttribute('d');
    const dragHead = page.locator(`[data-node-id="${sourceId}"] .canvas-node__head`);
    const box = await dragHead.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 95, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => state.nodes[0].x).toBeGreaterThan(start.x + 100);
    await expect.poll(() => state.nodes[0].y).toBeGreaterThan(start.y + 60);
    await expect.poll(async () => page.locator('.canvas-edge').getAttribute('d')).not.toBe(pathBefore);
    const persisted = { x: state.nodes[0].x, y: state.nodes[0].y };

    await page.reload();
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    await expect(page.locator(`[data-node-id="${sourceId}"]`)).toHaveCSS('transform', `matrix(1, 0, 0, 1, ${persisted.x}, ${persisted.y})`);

    page.once('dialog', (dialog) => dialog.accept('Renamed campaign'));
    await page.getByRole('button', { name: 'Rename Canvas: Campaign workflow', exact: true }).click();
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Renamed campaign');
    await expect.poll(() => state.projects[0].title).toBe('Renamed campaign');
    await expect(page.getByRole('button', { name: 'Rename Canvas: Renamed campaign', exact: true })).toBeVisible();

    await page.locator(`[data-node-id="${sourceId}"]`).press('Enter');
    const nodeTitle = page.getByLabel('Title', { exact: true });
    const originalTitle = await nodeTitle.inputValue();
    let unexpectedConfirmations = 0;
    const dismissUnexpected = (dialog) => { unexpectedConfirmations += 1; return dialog.dismiss(); };
    page.on('dialog', dismissUnexpected);
    await nodeTitle.focus();
    await nodeTitle.press('Home');
    await nodeTitle.press('Delete');
    await nodeTitle.press('End');
    await nodeTitle.press('Backspace');
    page.off('dialog', dismissUnexpected);
    expect(unexpectedConfirmations).toBe(0);
    expect(state.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    await nodeTitle.fill(originalTitle);
    await nodeTitle.blur();
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'saved');

    const edgeId = state.edges[0].id;
    await page.locator('.canvas-edge-hit').press('Enter');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#canvasDeleteSelection').click();
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    expect(state.requests.filter((request) => request.method === 'DELETE')).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#canvasDeleteSelection').click();
    await expect(page.locator('.canvas-edge')).toHaveCount(0);
    expect(state.edges).toEqual([]);

    await page.locator(`[data-node-id="${sourceId}"]`).press('Enter');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#canvasDeleteSelection').click();
    await expect(page.locator('.canvas-node')).toHaveCount(1);
    expect(state.nodes.some((node) => node.id === sourceId)).toBe(false);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete Canvas: Renamed campaign', exact: true }).click();
    await expect(page.locator('.canvas-project-item')).toHaveCount(0);
    await expect(page.locator('.canvas-node')).toHaveCount(0);
    expect(state.projects).toEqual([]);
    expect(state.nodes).toEqual([]);
    expect(state.requests.filter((request) => request.method === 'DELETE').map((request) => request.pathname)).toEqual([
      `/api/account/canvas/projects/11111111111111111111111111111111/edges/${edgeId}`,
      `/api/account/canvas/projects/11111111111111111111111111111111/nodes/${sourceId}`,
      '/api/account/canvas/projects/11111111111111111111111111111111',
    ]);
  });

  test('mobile Canvas opens the actual project controls and returns to the graph without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    await page.goto('/de/canvas/');
    await expect(page.locator('#canvasApp')).toBeVisible();
    await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
    await expect(page.locator('#canvasViewport')).toBeVisible();
    await page.locator('#canvasProjectsToggle').focus();
    await page.locator('#canvasProjectsToggle').press('Enter');
    await expect(page.locator('#canvasProjectsPanel')).toBeVisible();
    await expect(page.locator('#canvasNewProject')).toBeVisible();
    await expect(page.locator('#canvasViewport')).toBeHidden();
    await page.locator('#canvasGraphToggle').focus();
    await page.locator('#canvasGraphToggle').press('Enter');
    await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
    await expect(page.locator('#canvasViewport')).toBeVisible();
    await expect(page.locator('#canvasGraphToggle')).toBeFocused();
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewport: window.innerWidth, viewportHeight: innerHeight, appVisible: !document.getElementById('canvasApp').hidden }));
    expect(metrics.appVisible).toBe(true);
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  for (const locale of ['en', 'de']) {
    test(`Canvas ${locale}: viewport filling, centered empty graph and reversible desktop panels`, async ({ page }) => {
      await mockSharedAuth(page, true);
      const state = createCanvasApiMock(page);
      await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
      await expect(page.locator('#canvasCredits')).toContainText('500');
      const initialRequests = state.requests.length;
      for (const viewport of [{ width: 1440, height: 900 }, { width: 2560, height: 1440 }, { width: 1280, height: 600 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('#canvasProjectsPanel')).toBeVisible();
        await expect(page.locator('#canvasInspectorPanel')).toBeVisible();
        const geometry = await page.evaluate(() => {
          const bounds = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          return { docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, width: innerWidth, height: innerHeight,
            header: bounds('header'), app: bounds('#canvasApp'), graph: bounds('#canvasViewport'), empty: bounds('#canvasEmpty') };
        });
        expect(geometry.docWidth).toBeLessThanOrEqual(geometry.width + 1);
        expect(geometry.docHeight).toBeLessThanOrEqual(geometry.height + 1);
        expect(Math.abs(geometry.app.y - geometry.header.bottom)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.app.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.app.right - geometry.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.app.bottom - geometry.height)).toBeLessThanOrEqual(1);
        expect(geometry.graph.bottom).toBeLessThanOrEqual(geometry.height + 1);
        expect(geometry.graph.height).toBeGreaterThan(geometry.height * .55);
        expect(Math.abs(geometry.empty.x + geometry.empty.width / 2 - geometry.graph.x - geometry.graph.width / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.empty.y + geometry.empty.height / 2 - geometry.graph.y - geometry.graph.height / 2)).toBeLessThanOrEqual(2);
      }
      await page.locator('#canvasHistoryToggle').click();
      await expect(page.locator('#canvasHistoryPanel')).toBeVisible();
      await expect(page.locator('#canvasInspectorPanel')).toBeHidden();
      await expect(page.locator('#canvasRunHistory')).toContainText(locale === 'de' ? 'Verlauf' : 'history');
      await page.locator('#canvasInspectorToggle').click();
      await expect(page.locator('#canvasInspectorPanel')).toBeVisible();
      await expect(page.locator('#canvasHistoryPanel')).toBeHidden();
      await page.locator('#canvasProjectsToggle').click();
      await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
      await page.locator('#canvasProjectsToggle').press('Enter');
      await expect(page.locator('#canvasProjectsPanel')).toBeVisible();
      expect(state.requests.length).toBe(initialRequests);
      expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });
  }

  test('Canvas connection endpoints match the visible node ports in graph coordinates', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    const projectId = '1'.repeat(32), sourceId = '2'.repeat(32), targetId = '3'.repeat(32);
    state.projects.push({ id: projectId, title: 'Port geometry', locale: 'en', created_at: '2026-09-15T10:00:00.000Z', updated_at: '2026-09-15T10:00:00.000Z' });
    state.nodes.push(...[[sourceId, 40, 50], [targetId, 350, 240]].map(([id, x, y]) => ({ id, project_id: projectId, type: 'text_prompt', title: 'Prompt', x, y, model_id: null, config: {}, content: { prompt: 'Synthetic prompt' }, output: null, asset_id: null })));
    state.edges.push({ id: 'e'.repeat(32), project_id: projectId, source_node_id: sourceId, target_node_id: targetId, config: {} });
    await page.goto('/canvas/');
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
    const assertPorts = async () => {
      const geometry = await page.evaluate(({ sourceId, targetId }) => {
        const card = (id) => document.querySelector(`.canvas-node[data-node-id="${id}"]`);
        const center = (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        const edge = document.querySelector('.canvas-edge');
        const point = (distance) => { const p = edge.getPointAtLength(distance).matrixTransform(edge.getScreenCTM()); return { x: p.x, y: p.y }; };
        return { sourceWidth: card(sourceId).getBoundingClientRect().width, sourceY: card(sourceId).getBoundingClientRect().y,
          start: point(0), end: point(edge.getTotalLength()), out: center(card(sourceId).querySelector('[data-port="out"]')), in: center(card(targetId).querySelector('[data-port="in"]')) };
      }, { sourceId, targetId });
      expect(geometry.sourceWidth).toBe(230);
      expect(Math.abs(geometry.out.y - geometry.sourceY - 59)).toBeLessThanOrEqual(1);
      for (const axis of ['x', 'y']) {
        expect(Math.abs(geometry.start[axis] - geometry.out[axis])).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.end[axis] - geometry.in[axis])).toBeLessThanOrEqual(2);
      }
    };
    const positions = state.nodes.map(({ id, x, y }) => ({ id, x, y }));
    await assertPorts();
    await page.locator('#canvasViewport').evaluate((viewport) => viewport.scrollTo({ left: 120, top: 90, behavior: 'instant' }));
    await expect(page.locator('#canvasViewport')).toHaveJSProperty('scrollLeft', 120);
    await expect(page.locator('#canvasViewport')).toHaveJSProperty('scrollTop', 90);
    await assertPorts();
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.locator('#canvasProjectsToggle').click();
    await page.locator('#canvasInspectorToggle').click();
    await expect(page.locator('#canvasProjectsPanel')).toBeHidden();
    await expect(page.locator('#canvasInspectorPanel')).toBeHidden();
    await assertPorts();
    expect(state.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(positions);
    expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([]);
    await page.locator(`.canvas-node[data-node-id="${sourceId}"]`).press('ArrowRight');
    await expect.poll(() => state.nodes.find((node) => node.id === sourceId).x).toBe(50);
    await expect(page.locator('#canvasSaveState')).toHaveAttribute('data-state', 'saved');
    await assertPorts();
    expect(state.nodes.find((node) => node.id === sourceId).y).toBe(50);
    expect(state.requests.filter((request) => request.method !== 'GET')).toEqual([{ method: 'PATCH', pathname: `/api/account/canvas/projects/${projectId}/nodes/${sourceId}` }]);
  });

  for (const locale of ['en', 'de']) {
    test(`Canvas ${locale}: unavailable reads stay distinct from confirmed access denial`, async ({ page }) => {
      await mockSharedAuth(page, true);
      const state = createCanvasApiMock(page);
      for (const status of [401, 403, 503, 'network']) {
        await page.route('**/api/account/canvas/projects', (route) => status === 'network' ? route.abort('failed') : route.fulfill({ status, json: { ok: false, code: status === 503 ? 'unavailable' : 'unauthorized', error: 'Synthetic read failure' } }));
        await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
        await expect(page.locator(status === 401 || status === 403 ? '#canvasDenied' : '#canvasUnavailable')).toBeVisible();
        await expect(page.locator(status === 401 || status === 403 ? '#canvasUnavailable' : '#canvasDenied')).toBeHidden();
        await expect(page.locator('#canvasApp')).toBeHidden();
        expect(state.modelRequests).toBe(0);
        await page.unroute('**/api/account/canvas/projects');
      }
    });
  }

  test('quick workflow creates a connected Text to Image to Video graph with typed readiness', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    await page.goto('/canvas/');
    page.once('dialog', (dialog) => dialog.accept('Quick workflow'));
    await page.locator('#canvasNewProject').click();
    await page.locator('#canvasQuickTextImageVideo').click();
    await expect(page.locator('.canvas-node')).toHaveCount(3);
    await expect(page.locator('.canvas-edge')).toHaveCount(2);
    expect(state.nodes.map((node) => node.type)).toEqual(['text_generation', 'image_generation', 'video_generation']);
    expect(state.edges.map((edge) => [edge.source_node_id, edge.target_node_id])).toEqual([
      [state.nodes[0].id, state.nodes[1].id],
      [state.nodes[1].id, state.nodes[2].id],
    ]);
    await page.locator(`[data-node-id="${state.nodes[1].id}"]`).click();
    await expect(page.locator('.canvas-input-context')).toContainText('Run the upstream node first');
    await expect(page.locator('#canvasInspectorBody').getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  });

  test('inspector resolves generated text into an image prompt and Output displays latest upstream result', async ({ page }) => {
    await mockSharedAuth(page, true);
    const state = createCanvasApiMock(page);
    const now = new Date().toISOString();
    const project = { id: '11111111111111111111111111111111', title: 'Resolved flow', locale: 'en', thumbnail_asset_id: null, created_at: now, updated_at: now };
    const textId = '22222222222222222222222222222222';
    const imageId = '33333333333333333333333333333333';
    const outputId = '44444444444444444444444444444444';
    state.projects.push(project);
    state.nodes.push(
      { id: textId, project_id: project.id, type: 'text_generation', title: 'Prompt writer', x: 50, y: 50, model_id: '@cf/meta/llama-3.1-8b-instruct', config: { prompt: 'Improve it' }, content: {}, output: { kind: 'text', text: 'A cinematic glass city at blue hour.' }, asset_id: null, created_at: now, updated_at: now },
      { id: imageId, project_id: project.id, type: 'image_generation', title: 'Image', x: 350, y: 50, model_id: '@cf/black-forest-labs/flux-1-schnell', config: { prompt: '' }, content: {}, output: null, asset_id: null, created_at: now, updated_at: now },
      { id: outputId, project_id: project.id, type: 'output_result', title: 'Output', x: 650, y: 50, model_id: null, config: {}, content: {}, output: null, asset_id: null, created_at: now, updated_at: now },
    );
    state.edges.push(
      { id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', project_id: project.id, source_node_id: textId, target_node_id: imageId, label: null, config: {}, created_at: now, updated_at: now },
      { id: 'ffffffffffffffffffffffffffffffff', project_id: project.id, source_node_id: textId, target_node_id: outputId, label: null, config: {}, created_at: now, updated_at: now },
    );
    await page.goto('/canvas/');
    await page.locator(`[data-node-id="${imageId}"]`).click();
    await expect(page.locator('.canvas-input-context')).toContainText('Input from: Prompt writer');
    await expect(page.locator('.canvas-input-context')).toContainText('A cinematic glass city at blue hour.');
    await expect(page.locator('#canvasInspectorBody').getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.locator(`[data-node-id="${outputId}"]`).click();
    await expect(page.locator('.canvas-output pre')).toHaveText('A cinematic glass city at blue hour.');
  });
});
