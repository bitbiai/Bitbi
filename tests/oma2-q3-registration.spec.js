const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const waitpoint = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const registration = enabled => ({ enabled, settingPresent: true, storageAvailable: true, updatedAt: '2026-09-06T12:00:00Z' });
async function fixture(page, baseURL, handler) {
  const unexpected = []; const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.pathname); return route.abort(); }
    if (process.env.OMA2_Q3_REGISTRATION_BASELINE && url.pathname === '/js/pages/admin/settings.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(process.env.OMA2_Q3_REGISTRATION_BASELINE, url.pathname), 'utf8') });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let result = await handler(request, url);
    const admin = { id: 'q3-admin', email: 'admin@example.test', role: 'admin' };
    if (!result && url.pathname === '/api/admin/me') result = { body: { user: admin } };
    if (!result && url.pathname === '/api/me') result = { body: { loggedIn: true, user: admin } };
    if (!result && url.pathname === '/api/admin/users') result = { body: { users: [], has_more: false } };
    if (!result && url.pathname === '/api/admin/registration/status' && request.method() === 'GET') result = { body: { registration: registration(true) } };
    if (!result) { if (request.method() !== 'GET') unexpected.push(request.method() + ' ' + url.pathname); result = { status: 503, body: { ok: false, error: 'Unconfigured read fixture' } }; }
    if (result.abort) return route.abort('failed');
    return route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...result.body }) });
  });
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/admin/index.html#registration-settings');
  await expect(page.locator('#registrationAvailabilityPanel')).toBeVisible();
  return { unexpected, errors };
}
const changeRoute = (page, hash) => page.evaluate(value => { location.hash = value; }, hash);
const finish = evidence => { expect(evidence.unexpected).toEqual([]); expect(evidence.errors).toEqual([]); };

test('an empty successful response does not assert enabled registration availability', async ({ page, baseURL }) => {
  const evidence = await fixture(page, baseURL, (request, url) => {
    if (url.pathname === '/api/admin/registration/status') return { body: {} };
  });
  await expect(page.locator('#registrationAvailabilityState')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#registrationAvailabilityStatusText')).toHaveText('Availability not verified');
  await expect(page.locator('#registrationAvailabilityStatusText')).not.toHaveAttribute('data-state', 'success');
  finish(evidence);
});

for (const width of [1440, 390]) {
  test.describe(`Q3 registration ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test('a confirmed initial read and alias return preserve an unsaved registration draft', async ({ page, baseURL }) => {
      let reads = 0;
      const evidence = await fixture(page, baseURL, (request, url) => { if (url.pathname === '/api/admin/registration/status') reads += 1; });
      await expect(page.locator('#registrationAvailabilityState')).toContainText('loaded');
      await page.locator('#registrationEnabledToggle').uncheck(); await page.locator('#registrationAvailabilityReason').fill('Unsaved maintenance note');
      await changeRoute(page, 'security'); await expect(page.locator('#sectionSecurity')).toBeVisible();
      await changeRoute(page, 'registration-settings'); await expect(page.locator('#adminSectionState')).toBeHidden();
      await expect(page.locator('#registrationEnabledToggle')).not.toBeChecked();
      await expect(page.locator('#registrationAvailabilityReason')).toHaveValue('Unsaved maintenance note');
      expect(reads).toBe(1); finish(evidence);
    });
    test('a delayed initial read cannot overwrite a draft started during loading', async ({ page, baseURL }) => {
      const held = waitpoint();
      const evidence = await fixture(page, baseURL, async (request, url) => { if (url.pathname === '/api/admin/registration/status') { await held.promise; return { body: { registration: registration(true) } }; } });
      await page.locator('#registrationEnabledToggle').uncheck(); await page.locator('#registrationAvailabilityReason').fill('Draft before read completes');
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/registration/status'); held.resolve(); await (await response).finished(); await settle(page);
      await expect(page.locator('#registrationEnabledToggle')).not.toBeChecked();
      await expect(page.locator('#registrationAvailabilityReason')).toHaveValue('Draft before read completes');
      await expect(page.locator('#registrationAvailabilityState')).toContainText('unsaved'); finish(evidence);
    });
  });
}

test('Save A retains its payload and double-submit guard while later draft B survives success', async ({ page, baseURL }) => {
  const held = waitpoint(); const writes = [];
  const evidence = await fixture(page, baseURL, async (request, url) => {
    if (url.pathname === '/api/admin/registration/status' && request.method() === 'POST') { writes.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] }); await held.promise; return { body: { registration: registration(false) } }; }
  });
  await expect(page.locator('#registrationAvailabilityState')).toContainText('loaded');
  await page.locator('#registrationEnabledToggle').uncheck(); await page.locator('#registrationAvailabilityReason').fill('Original A note');
  await page.locator('#registrationAvailabilitySaveBtn').dblclick(); await expect.poll(() => writes.length).toBe(1);
  await page.locator('#registrationEnabledToggle').check(); await page.locator('#registrationAvailabilityReason').fill('Later B note');
  const response = page.waitForResponse(r => r.request().method() === 'POST'); held.resolve(); await (await response).finished(); await settle(page);
  await expect(page.locator('#registrationEnabledToggle')).toBeChecked(); await expect(page.locator('#registrationAvailabilityReason')).toHaveValue('Later B note');
  await expect(page.locator('#registrationAvailabilityState')).toContainText('unsaved');
  expect(writes[0].body.enabled).toBe(false); expect(writes[0].body.reason).toBe('Original A note'); expect(writes).toHaveLength(1); finish(evidence);
});

test('an explicit retry keeps the unknown original intent and does not submit edited B', async ({ page, baseURL }) => {
  const writes = [];
  const evidence = await fixture(page, baseURL, async (request, url) => {
    if (url.pathname === '/api/admin/registration/status' && request.method() === 'POST') { writes.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] }); if (writes.length === 1) return { abort: true }; return { body: { registration: registration(false) } }; }
  });
  await expect(page.locator('#registrationAvailabilityState')).toContainText('loaded');
  await page.locator('#registrationEnabledToggle').uncheck(); await page.locator('#registrationAvailabilityReason').fill('Original A note');
  await page.locator('#registrationAvailabilitySaveBtn').click(); await expect(page.locator('#registrationAvailabilityState')).toContainText('not confirmed');
  await page.locator('#registrationEnabledToggle').check(); await page.locator('#registrationAvailabilityReason').fill('Later B note');
  await page.getByRole('button', { name: 'Retry original registration change', exact: true }).click();
  await expect(page.locator('#registrationAvailabilityState')).toContainText('unsaved');
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  await expect(page.locator('#registrationEnabledToggle')).toBeChecked(); await expect(page.locator('#registrationAvailabilityReason')).toHaveValue('Later B note'); finish(evidence);
});

test('read errors retry on return and a hidden old read cannot replace the new result', async ({ page, baseURL }) => {
  const held = waitpoint(); let reads = 0;
  const evidence = await fixture(page, baseURL, async (request, url) => {
    if (url.pathname !== '/api/admin/registration/status') return;
    reads += 1;
    if (reads === 1) return { status: 503, body: { ok: false, error: 'Synthetic unavailable' } };
    if (reads === 2) { await held.promise; return { body: { registration: registration(true) } }; }
    return { body: { registration: registration(false) } };
  });
  await expect(page.locator('#registrationAvailabilityState')).toHaveAttribute('data-state', 'error');
  await changeRoute(page, 'security'); await expect(page.locator('#sectionSecurity')).toBeVisible();
  await changeRoute(page, 'users'); await expect.poll(() => reads).toBe(2);
  await changeRoute(page, 'security'); await expect(page.locator('#sectionSecurity')).toBeVisible();
  await changeRoute(page, 'registration-settings'); await expect.poll(() => reads).toBe(3);
  await expect(page.locator('#registrationAvailabilityState')).toContainText('loaded');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/registration/status'); held.resolve(); await (await response).finished(); await settle(page);
  await expect(page.locator('#registrationEnabledToggle')).not.toBeChecked(); finish(evidence);
});

test('normal save is confirmed, missing reason stays blocked and success can be reopened', async ({ page, baseURL }) => {
  let saved = true; let writes = 0;
  const evidence = await fixture(page, baseURL, (request, url) => {
    if (url.pathname !== '/api/admin/registration/status') return;
    if (request.method() === 'POST') { saved = request.postDataJSON().enabled; writes += 1; }
    return { body: { registration: registration(saved) } };
  });
  await expect(page.locator('#registrationAvailabilityState')).toContainText('loaded');
  await page.locator('#registrationEnabledToggle').uncheck(); await page.locator('#registrationAvailabilitySaveBtn').click();
  await expect(page.locator('#registrationAvailabilityReason')).toBeFocused(); expect(writes).toBe(0);
  await page.locator('#registrationAvailabilityReason').fill('Synthetic operator decision'); await page.locator('#registrationAvailabilitySaveBtn').click();
  await expect(page.locator('#registrationAvailabilityState')).toContainText('saved');
  await expect(page.locator('#registrationAvailabilityReason')).toHaveValue('');
  await changeRoute(page, 'security'); await expect(page.locator('#sectionSecurity')).toBeVisible();
  await changeRoute(page, 'registration-settings'); await expect(page.locator('#registrationAvailabilityState')).toContainText('loaded');
  await expect(page.locator('#registrationEnabledToggle')).not.toBeChecked(); expect(writes).toBe(1); finish(evidence);
});
