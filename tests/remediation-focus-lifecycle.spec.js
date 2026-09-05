const { test, expect, fixture, home, openAuth } = require('./helpers/remediation-ui-fixtures');
const fs = require('node:fs');

// Optional, bounded diagnostics. No request/response body, header, password,
// cookie or session data is recorded. Baseline overrides use verified source
// files supplied by the isolated runner; application files are never changed.
test.beforeEach(async ({ page }, info) => {
  if (!process.env.BITBI_FOCUS_DIAGNOSTICS) return;
  const entries = [];
  page.__focusDiagnostics = entries;
  page.on('console', message => entries.push({ kind: 'console', type: message.type(), text: message.text() }));
  page.on('pageerror', error => entries.push({ kind: 'pageerror', message: error.message }));
  page.on('response', response => entries.push({ kind: 'response', method: response.request().method(), pathname: new URL(response.url()).pathname, status: response.status() }));
  page.on('requestfailed', request => entries.push({ kind: 'requestfailed', pathname: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  await page.addInitScript(() => {
    const events = [];
    window.__focusDiagnostics = events;
    const record = entry => { if (events.length < 1000) events.push({ time: performance.now(), active: document.activeElement?.id, ...entry }); };
    const nativeFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(...args) {
      record({ kind: 'focus-call', target: this.id || this.className, stack: new Error().stack });
      return nativeFocus.apply(this, args);
    };
    document.addEventListener('focusin', event => record({ kind: 'focusin', target: event.target.id || event.target.className }));
    for (const capture of [true,false]) document.addEventListener('keydown', event => {
      if (['Tab','Escape'].includes(event.key)) record({ kind: 'keydown', capture, key: event.key, shift: event.shiftKey, prevented: event.defaultPrevented });
    }, capture);
  });
  info.annotations.push({ type: 'focus-diagnostic-variant', description: process.env.BITBI_FOCUS_BASELINE_DIR ? 'original helper and Credits consumer route override' : 'current worktree' });
});

test.afterEach(async ({ page }, info) => {
  if (!process.env.BITBI_FOCUS_DIAGNOSTICS) return;
  const focus = await page.evaluate(() => window.__focusDiagnostics || []).catch(() => []);
  await info.attach('focus-network-console.json', { body: Buffer.from(JSON.stringify({ repeatEachIndex: info.repeatEachIndex, focus, requestsAndConsole: page.__focusDiagnostics || [] }, null, 2)), contentType: 'application/json' });
});


async function creditsFixture(page, locale) {
  const state = await fixture(page, { member: true });
  if (process.env.BITBI_FOCUS_BASELINE_DIR) {
    for (const [pathname, filename] of [['focus-trap.js', 'original-focus-trap.js'], ['credits/main.js', 'original-credits-main.js']]) {
      const body = fs.readFileSync(`${process.env.BITBI_FOCUS_BASELINE_DIR}/${filename}`, 'utf8');
      const pattern = pathname.startsWith('credits/') ? '**/js/pages/credits/main.js*' : '**/js/shared/focus-trap.js*';
      await page.route(pattern, route => route.fulfill({ status: 200, contentType: 'text/javascript', body }));
    }
  }
  const dashboard = {
    account: { userId: 'credits-focus-fixture', email: 'credits-focus@example.invalid', role: 'user', status: 'active' },
    balance: { current: 10000, available: 10000, totalCredits: 10000, subscriptionCredits: 6000, legacyOrBonusCredits: 0, purchasedCredits: 4000, lifetimeConsumed: 0 },
    dailyTopUp: null, liveCheckout: { enabled: true, configured: true, mode: 'live' },
    subscriptionStatus: 'active', subscriptionPeriodStart: '2026-05-01T00:00:00.000Z', subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
    nextRenewalDate: '2026-06-01T00:00:00.000Z', activeUntil: '2026-06-01T00:00:00.000Z', cancelAtPeriodEnd: false,
    canCancelSubscription: true, canReactivateSubscription: false, storageLimitBytes: 5368709120, hasActiveSubscription: true,
    packs: [], purchaseHistory: [], transactions: [],
  };
  const json = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/api/orgs*', route => route.fulfill(json({ ok: true, organizations: [] })));
  await page.route('**/api/account/credits-dashboard*', route => route.fulfill(json({ ok: true, dashboard })));
  await page.goto(`${locale === 'de' ? '/de' : ''}/account/credits.html?scope=member`);
  await expect(page.locator('[data-subscription-action="cancel"]')).toBeVisible();
  return state;
}

async function settleMockResponse(page, responsePromise, release) {
  release();
  const response = await responsePromise;
  await response.finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function pendingLogin(page, responseBody, status) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/login', async route => {
    calls++;
    await gate;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(responseBody) });
  });
  await openAuth(page, 'login');
  await page.locator('#authLoginForm input[type="email"]').fill('lifecycle@example.invalid');
  await page.locator('#authLoginForm input[type="password"]').fill('disposable-password');
  const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/login');
  const submit = page.locator('#authLoginForm button[type="submit"]');
  const originalSubmit = await submit.elementHandle();
  await submit.click();
  await expect(submit).toBeDisabled();
  return { release, response, originalSubmit, calls: () => calls };
}

for (const locale of ['en', 'de']) {
  test.describe(`focus lifecycle ${locale}`, () => {
    test.beforeEach(async ({ browser }, info) => {
      info.annotations.push({ type: 'browser-version', description: browser.version() });
    });

    test('Credits delayed opening work cannot overwrite keyboard focus', async ({ page }) => {
      const state = await creditsFixture(page, locale);
      // Hold only zero-delay work queued by the actual Credits consumer while
      // opening. This makes a browser event ordering reproducible without
      // replacing the consumer, focus helper or native keyboard event.
      await page.evaluate(() => {
        const nativeTimeout = window.setTimeout.bind(window);
        window.__creditsHeldTasks = [];
        window.setTimeout = (callback, delay, ...args) => {
          if (delay === 0 && typeof callback === 'function' && new Error().stack.includes('/js/pages/credits/main.js')) {
            window.__creditsHeldTasks.push(() => callback(...args));
            return -window.__creditsHeldTasks.length;
          }
          return nativeTimeout(callback, delay, ...args);
        };
      });
      const trigger = page.locator('[data-subscription-action="cancel"]');
      await trigger.focus();
      // Keyboard entry fixes the captured opener across browser pointer-focus conventions.
      await trigger.press('Enter');
      await expect(page.locator('#creditsSubscriptionDialogCancel')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#creditsSubscriptionDialogConfirm')).toBeFocused();
      await page.evaluate(() => { for (const task of window.__creditsHeldTasks.splice(0)) task(); });
      await expect(page.locator('#creditsSubscriptionDialogConfirm')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('#creditsSubscriptionDialogCancel')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-subscription-action="cancel"]')).toBeFocused();
      expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });

    test('Credits natural cancellation dialog focus preserves existing keyboard assertions', async ({ page }) => {
      const state = await creditsFixture(page, locale);
      const trigger = page.locator('[data-subscription-action="cancel"]');
      await trigger.focus();
      // Keyboard entry fixes the captured opener across browser pointer-focus conventions.
      await trigger.press('Enter');
      await expect(page.locator('#creditsSubscriptionDialog')).toBeVisible();
      await expect(page.locator('#creditsSubscriptionDialog')).toHaveAttribute('aria-describedby', 'creditsSubscriptionDialogBody');
      await expect(page.locator('#creditsSubscriptionDialogTitle')).toHaveText(locale === 'de' ? 'Abo zum Periodenende kündigen?' : 'Cancel subscription at period end?');
      await expect(page.locator('#creditsSubscriptionDialogBody')).toContainText(locale === 'de' ? 'bleibt bis zum Ende' : 'remains active');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogCancel');
      await page.keyboard.press('Shift+Tab');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogConfirm');
      await page.keyboard.press('Tab');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('creditsSubscriptionDialogCancel');
      await page.keyboard.press('Escape');
      await expect(page.locator('#creditsSubscriptionDialog')).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });

    test('Auth failed login completed after close cannot relock the page', async ({ page }) => {
      const state = await home(page, locale);
      const trigger = page.locator('#navbar [data-category-link="video"]');
      await trigger.focus();
      const pending = await pendingLogin(page, { error: 'Delayed fixture failure' }, 401);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await settleMockResponse(page, pending.response, pending.release);
      await expect.poll(() => pending.originalSubmit.evaluate(button => button.disabled)).toBe(false);
      await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      await expect(trigger).toBeFocused();
      expect(pending.calls()).toBe(1); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });

    test('Auth old successful login cannot close a newer dialog opening', async ({ page }) => {
      const state = await home(page, locale);
      const pending = await pendingLogin(page, { ok: true }, 200);
      await page.keyboard.press('Escape');
      await openAuth(page, 'register');
      await page.evaluate(() => { window.__authStateCompletions = 0; document.addEventListener('bitbi:auth-change', () => window.__authStateCompletions++); });
      await settleMockResponse(page, pending.response, pending.release);
      await expect.poll(() => pending.originalSubmit.evaluate(button => button.disabled)).toBe(false);
      await expect.poll(() => page.evaluate(() => window.__authStateCompletions)).toBeGreaterThan(0);
      await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
      await expect(page.locator('#authRegisterForm')).toHaveClass(/active/);
      await expect(page.locator('.auth-modal__close')).toBeFocused();
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      await page.keyboard.press('Escape');
      expect(pending.calls()).toBe(1); expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });

    test('Auth old registration completion preserves a newer opening and entered values', async ({ page }) => {
      const state = await home(page, locale);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/api/register', async route => {
        await gate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });
      await openAuth(page, 'register');
      await page.locator('#authRegisterForm input[type="email"]').fill('first-opening@example.invalid');
      await page.locator('#authRegisterForm input[type="password"]').fill('disposable-password');
      const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/register');
      await page.locator('#authRegisterForm button[type="submit"]').click();
      await expect(page.locator('#authRegisterForm button[type="submit"]')).toBeDisabled();
      await page.evaluate(async () => (await import('/js/shared/auth-modal.js')).openAuthModal('register', { message: 'New opening message' }));
      await page.locator('#authRegisterForm input[type="email"]').fill('new-opening@example.invalid');
      await settleMockResponse(page, response, release);
      await expect(page.locator('#authRegisterMsg')).toHaveText('New opening message');
      await expect(page.locator('#authRegisterForm input[type="email"]')).toHaveValue('new-opening@example.invalid');
      await expect(page.locator('#authRegisterForm button[type="submit"]')).toBeEnabled();
      await page.keyboard.press('Escape');
      expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });

    test('Auth old resend completion cannot replace a newer opening message', async ({ page }) => {
      const state = await home(page, locale);
      const login = await pendingLogin(page, { error: 'Local verification fixture', code: 'EMAIL_NOT_VERIFIED' }, 403);
      await settleMockResponse(page, login.response, login.release);
      await expect(page.locator('#authLoginMsg a')).toBeVisible();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/api/resend-verification', async route => {
        await gate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });
      const response = page.waitForResponse(candidate => new URL(candidate.url()).pathname === '/api/resend-verification');
      await page.locator('#authLoginMsg a').click();
      await page.evaluate(async () => (await import('/js/shared/auth-modal.js')).openAuthModal('login', { target: 'login', message: 'New login opening message' }));
      await settleMockResponse(page, response, release);
      await expect(page.locator('#authLoginMsg')).toHaveText('New login opening message');
      await expect(page.locator('.auth-modal__close')).toBeFocused();
      await page.keyboard.press('Escape');
      expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });

    test('Auth closing transition ownership survives rapid reopen and child events', async ({ page }) => {
      const state = await home(page, locale);
      await openAuth(page, 'login');
      const observed = await page.evaluate(async () => {
        const modal = document.querySelector('.auth-modal__overlay');
        const { closeAuthModal, openAuthModal } = await import('/js/shared/auth-modal.js');
        closeAuthModal();
        modal.querySelector('.auth-modal__card').dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity', bubbles: true }));
        const afterChildTransition = modal.style.display;
        openAuthModal('register');
        modal.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity', bubbles: true }));
        return { afterChildTransition, afterReopen: modal.style.display, active: modal.classList.contains('active'), inert: modal.inert };
      });
      expect(observed).toEqual({ afterChildTransition: '', afterReopen: '', active: true, inert: false });
      await expect(page.locator('#authRegisterForm')).toBeVisible();
      await page.keyboard.press('Escape');
      expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]);
    });
  });
}
