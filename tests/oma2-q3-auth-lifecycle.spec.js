const { test, expect } = require('@playwright/test');
const admin = { id: 'q3-admin-A', email: 'admin-a@example.test', role: 'admin' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(page, baseURL, observed, order, primary = null) {
  const headerGate = deferred(), adminGate = deferred();
  const started = { header: deferred(), admin: deferred() };
  const calls = [], unexpected = [], pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    calls.push(url.pathname);
    let response;
    if (url.pathname === '/api/me') { started.header.resolve(); await headerGate.promise; response = observed; }
    else if (url.pathname === '/api/admin/me') { started.admin.resolve(); await adminGate.promise; response = primary || { body: { ok: true, user: admin } }; }
    else if (url.pathname === '/api/admin/stats') response = { body: { ok: true, stats: { totalUsers: 12, activeUsers: 10 } } };
    else if (url.pathname === '/api/admin/users') response = { body: { ok: true, users: [{ id: 'q3-user-A', email: 'artist@example.test', role: 'user' }], has_more: false } };
    else if (url.pathname === '/api/admin/registration/status') response = { body: { ok: true, registration: { enabled: true } } };
    else if (url.pathname === '/api/admin/billing/events') response = { body: { ok: true, events: [] } };
    else if (url.pathname === '/api/admin/ai/usage-attempts') response = { body: { ok: true, attempts: [] } };
    else if (url.pathname === '/api/admin/data-lifecycle/requests') response = { body: { ok: true, requests: [] } };
    else response = { status: 503, body: { ok: false, error: 'Unconfigured bounded read' } };
    if (request.method() !== 'GET') unexpected.push(request.method() + ' ' + url.pathname);
    if (response.abort) return route.abort('failed');
    return route.fulfill({ status: response.status || 200, contentType: response.contentType || 'application/json', body: response.rawBody || JSON.stringify(response.body) });
  });
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
  await page.goto('/admin/index.html'); await Promise.all([started.header.promise, started.admin.promise]);
  if (order === 'header-first') {
    headerGate.resolve();
    await page.waitForFunction(async () => (await import('/js/shared/auth-state.js')).getAuthState().ready);
    adminGate.resolve();
  } else {
    adminGate.resolve();
    if (primary) await expect(page.locator('#adminDenied')).toBeVisible();
    else await expect(page.locator('#statTotal')).toHaveText('12');
    headerGate.resolve();
    await page.waitForFunction(async () => (await import('/js/shared/auth-state.js')).getAuthState().ready);
  }
  return { calls, unexpected, pageErrors };
}
function clean(evidence) { expect(evidence.unexpected).toEqual([]); expect(evidence.pageErrors).toEqual([]); }
for (const order of ['header-first', 'admin-first']) {
  test(`same real header actor opens a usable Admin workspace: ${order}`, async ({ page, baseURL }) => {
    const evidence = await setup(page, baseURL, { body: { loggedIn: true, user: admin } }, order);
    await expect(page.locator('#sectionDashboard')).toHaveAttribute('data-load-state', 'ready');
    await expect(page.locator('#statTotal')).toHaveText('12');
    await page.locator('#adminOwnerActionSummary a[href="#users"]').click();
    await expect(page.locator('#sectionUsers')).toContainText('artist@example.test');
    await expect(page.locator('#searchInput')).toBeVisible(); clean(evidence);
  });
  for (const [name, response] of [
    ['guest', { body: { loggedIn: false, user: null } }],
    ['other-admin', { body: { loggedIn: true, user: { ...admin, id: 'q3-admin-B' } } }],
    ['non-admin', { body: { loggedIn: true, user: { ...admin, role: 'user' } } }],
  ]) test(`confirmed ${name} cannot open or retain Admin data: ${order}`, async ({ page, baseURL }) => {
    const evidence = await setup(page, baseURL, response, order);
    await expect(page.locator('#adminDenied')).toBeVisible();
    await expect(page.locator('#adminPanel')).not.toBeVisible();
    await page.evaluate(() => {
      location.hash = 'users';
      document.dispatchEvent(new CustomEvent('admin:open-context', { detail: { section: 'users', userId: 'q3-user-A' } }));
    });
    await expect(page.locator('#adminPanel')).not.toBeVisible();
    expect(evidence.calls).not.toContain('/api/admin/users');
    if (order === 'header-first') expect(evidence.calls).not.toContain('/api/admin/stats');
    clean(evidence);
  });
  for (const [name, response] of [
    ['unavailable', { status: 503, body: { ok: false, error: 'Temporary fixture outage' } }],
    ['network-error', { abort: true }],
    ['malformed-success', { body: { ok: true } }],
    ['missing-role', { body: { loggedIn: true, user: { id: admin.id } } }],
    ['blank-identity', { body: { loggedIn: true, user: { ...admin, id: '   ' } } }],
    ['contradictory-guest', { body: { loggedIn: false, user: admin } }],
    ['bare-401', { status: 401, body: { error: 'Authentication gateway response' } }],
    ['waf-html-403', { status: 403, contentType: 'text/html', rawBody: '<!doctype html><title>Access denied</title><p>Error 1010</p>' }],
  ]) test(`unknown ${name} blocks with an explicit recheck, without claiming logout: ${order}`, async ({ page, baseURL }) => {
    const evidence = await setup(page, baseURL, response, order);
    await expect(page.locator('#adminDenied')).toBeVisible();
    await expect(page.locator('#adminDeniedMessage')).toContainText('Session status could not be confirmed');
    await expect(page.locator('#adminDeniedMessage')).not.toContainText('You do not have permission');
    await expect(page.getByRole('button', { name: 'Reload to check again', exact: true })).toBeVisible();
    await expect(page.locator('#adminPanel')).not.toBeVisible();
    const auth = await page.evaluate(async () => (await import('/js/shared/auth-state.js')).getAuthState());
    expect(auth.sessionConfirmed).toBe(false);
    if (order === 'admin-first') await expect(page.locator('#statTotal')).toHaveText('12');
    clean(evidence);
  });
}

// A primary Admin authorization read must distinguish a server decision from
// a network/gateway/schema failure, regardless of the shared-header ordering.
for (const order of ['header-first', 'admin-first']) {
  for (const [name, response] of [
    ['503', { status: 503, body: { ok: false, error: 'Service temporarily unavailable.', code: 'ADMIN_MFA_UNAVAILABLE' } }],
    ['network', { abort: true }],
    ['HTML-403', { status: 403, contentType: 'text/html', rawBody: '<!doctype html><title>Forbidden</title><p>Error 1010</p>' }],
    ['missing-user', { body: { ok: true } }],
    ['missing-role', { body: { ok: true, user: { id: admin.id } } }],
    ['blank-identity', { body: { ok: true, user: { ...admin, id: '   ' } } }],
    ['bare-401', { status: 401, body: { error: 'Unidentified gateway response' } }],
  ]) test(`primary Admin check unknown ${name}: ${order}`, async ({ page, baseURL }) => {
    const evidence = await setup(page, baseURL, { body: { loggedIn: true, user: admin } }, order, response);
    await expect(page.locator('#adminDeniedMessage')).toContainText('Session status could not be confirmed');
    await expect(page.locator('#adminDeniedMessage')).not.toContainText('You do not have permission');
    await expect(page.getByRole('button', { name: 'Reload to check again', exact: true })).toBeVisible();
    await expect(page.locator('#adminPanel')).not.toBeVisible();
    await expect(page.locator('#adminMfaGate')).not.toBeVisible();
    expect(evidence.calls).not.toContain('/api/admin/stats');
    clean(evidence);
  });
  for (const [status, error] of [[401, 'Not authenticated.'], [403, 'Admin privileges required.']]) {
    test(`primary Admin check denied ${status}: ${order}`, async ({ page, baseURL }) => {
      const evidence = await setup(page, baseURL, { body: { loggedIn: true, user: admin } }, order,
        { status, body: { ok: false, error } });
      await expect(page.locator('#adminDeniedMessage')).toContainText('You do not have permission');
      await expect(page.getByRole('button', { name: 'Reload to check again', exact: true })).toHaveCount(0);
      await expect(page.locator('#adminPanel')).not.toBeVisible();
      await expect(page.locator('#adminMfaGate')).not.toBeVisible();
      expect(evidence.calls).not.toContain('/api/admin/stats');
      clean(evidence);
    });
  }
}

// Real auth-state/API modules in an otherwise empty local page. These two cases
// isolate response ordering; they are not complete login/logout journeys.
async function stateFixture(page, baseURL, handle) {
  const unexpected = [];
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.origin); return route.abort(); }
    if (url.pathname === '/q3-auth-state-fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic auth ordering</title>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const response = await handle(request, url);
    if (!response) { unexpected.push(request.method() + ' ' + url.pathname); return route.abort(); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/q3-auth-state-fixture.html');
  return unexpected;
}
test('a superseded session read cannot replace a newer confirmed actor', async ({ page, baseURL }) => {
  const held = deferred(); let reads = 0;
  const unexpected = await stateFixture(page, baseURL, async (request, url) => {
    if (url.pathname !== '/api/me') return null;
    const first = ++reads === 1;
    if (first) await held.promise;
    return { loggedIn: true, user: { ...admin, id: first ? 'old-A' : 'current-B' } };
  });
  await page.evaluate(async () => { const auth = await import('/js/shared/auth-state.js'); window.oldSessionRead = auth.initAuth(); });
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(async () => { await (await import('/js/shared/auth-state.js')).initAuth(); });
  held.resolve(); await page.evaluate(() => window.oldSessionRead);
  const auth = await page.evaluate(async () => (await import('/js/shared/auth-state.js')).getAuthState());
  expect(auth.user.id).toBe('current-B'); expect(auth.sessionConfirmed).toBe(true); expect(unexpected).toEqual([]);
});
test('a session read started before successful logout cannot resurrect that actor', async ({ page, baseURL }) => {
  const held = deferred(); let reads = 0, logouts = 0;
  const unexpected = await stateFixture(page, baseURL, async (request, url) => {
    if (url.pathname === '/api/logout' && request.method() === 'POST') { logouts += 1; return { ok: true }; }
    if (url.pathname !== '/api/me') return null;
    if (++reads === 2) await held.promise;
    return { loggedIn: true, user: admin };
  });
  await page.evaluate(async () => { await (await import('/js/shared/auth-state.js')).initAuth(); });
  await page.evaluate(async () => { const auth = await import('/js/shared/auth-state.js'); window.oldSessionRead = auth.initAuth(); });
  await expect.poll(() => reads).toBe(2);
  // Existing redirectTo API, same-document destination so the pending promise can
  // be observed. Production's default hard-reload behavior is unchanged.
  await page.evaluate(async () => { await (await import('/js/shared/auth-state.js')).authLogout({ redirectTo: '#signed-out' }); });
  held.resolve(); await page.evaluate(() => window.oldSessionRead);
  const auth = await page.evaluate(async () => (await import('/js/shared/auth-state.js')).getAuthState());
  expect(auth).toMatchObject({ loggedIn: false, user: null, sessionConfirmed: true }); expect(logouts).toBe(1); expect(unexpected).toEqual([]);
});
