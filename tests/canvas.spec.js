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
  const state = { projects: [], nodes: [], edges: [], runs: [], modelRequests: 0 };
  const model = {
    id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell', vendor: 'Cloudflare', capability: 'image',
    description: 'Fast image model.', outputType: 'image', canvasEnabled: true, runnable: true, disabledReason: null,
    pricingStatus: 'member_credit_priced', estimatedCredits: 1, controls: { maxPromptLength: 1000 },
  };
  const fulfill = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { ok: true, data } : data) });

  page.route('**/api/account/canvas/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    if (!authenticated) return fulfill(route, { ok: false, error: 'Authentication required.', code: 'unauthorized' }, 401);
    if (pathname.endsWith('/models')) { state.modelRequests += 1; return fulfill(route, { models: [model] }); }
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
    if (pathname === `/api/account/canvas/projects/${projectId}/edges` && method === 'POST') {
      const body = request.postDataJSON();
      const edge = { id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', project_id: projectId, ...body, label: null, config: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.edges.push(edge);
      return fulfill(route, { edge }, 201);
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

    await page.locator('.canvas-node').nth(0).locator('[data-port="out"]').click();
    await page.locator('.canvas-node').nth(1).locator('[data-port="in"]').click();
    await expect.poll(() => state.edges.length).toBe(1);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await expect(page.locator('.canvas-edge')).toHaveCount(1);
  });

  test('mobile Canvas uses a stacked, reachable editor without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSharedAuth(page, true);
    createCanvasApiMock(page);
    await page.goto('/de/canvas/');
    await expect(page.locator('.canvas-mobile-note')).toBeVisible();
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth, appVisible: !document.getElementById('canvasApp').hidden }));
    expect(metrics.appVisible).toBe(true);
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport + 1);
  });
});
