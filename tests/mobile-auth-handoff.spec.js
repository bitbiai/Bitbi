const { test, expect, fixture } = require('./helpers/remediation-ui-fixtures');

test.use({ timezoneId: 'Europe/Berlin' });

async function visit(page, locale, pathname, consent) {
  const state = await fixture(page);
  await page.goto(`${locale === 'de' ? '/de' : ''}${pathname}`);
  await expect(page.locator('.auth-modal__overlay')).toBeAttached();
  if (consent === 'not-applicable') {
    // Pricing uses the shared header but does not initialize the homepage banner.
    await expect(page.locator('#cookieBanner')).toHaveCount(0);
  } else {
    await expect(page.locator('#cookieBanner')).toBeVisible();
    if (consent === 'dismissed') {
      await page.locator('#ckRejectAll').click();
      await expect(page.locator('#cookieBanner')).toHaveCount(0);
    }
  }
  return state;
}

async function openMobileLogin(page) {
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileNav')).toHaveAttribute('data-state', 'open');
  // Real target handler and ancestor handlers: do not call the modal or focus
  // helpers directly, since their order is the regression under test.
  await page.locator('#mobileNav .mobile-nav__cta').click();
  await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
  await expect(page.locator('.auth-modal__close')).toBeFocused();
}

async function settledHandoff(page) {
  // Choose the next control while the menu is closing; settling callbacks must
  // preserve that keyboard action rather than reasserting initial focus.
  await page.keyboard.press('Tab');
  const loginTab = page.locator('.auth-modal__tab[data-tab="login"]');
  await expect(loginTab).toBeFocused();
  await expect(page.locator('#mobileNav')).toHaveAttribute('data-state', 'closed');
  await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#mobileMenuBtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(loginTab).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
}

async function closeLogin(page, visibleButton = false) {
  if (visibleButton) await page.locator('.auth-modal__close').click();
  else await page.keyboard.press('Escape');
  await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
  await expect(page.locator('#mobileMenuBtn')).toBeFocused();
  await expect(page.locator('#mobileMenuBtn')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
}

async function keyboardContainment(page) {
  const modal = page.locator('.auth-modal__overlay');
  const count = await modal.evaluate(element => [...element.querySelectorAll('button,a[href],input')]
    .filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length).length);
  expect(count).toBeGreaterThan(3);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < count + 2; index++) {
      await page.keyboard.press(key);
      expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
  }
}

for (const locale of ['en', 'de']) {
  test.describe(`mobile auth handoff ${locale}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    for (const consent of ['present', 'dismissed']) {
      test(`homepage login owns focus with cookie banner ${consent}`, async ({ page }) => {
        const state = await visit(page, locale, '/', consent);
        await openMobileLogin(page);
        await settledHandoff(page);
        await keyboardContainment(page);
        await closeLogin(page);

        // Begin menu reopening immediately after auth closes, while its fade
        // can still be running; use real controls and menu lifecycle states.
        await openMobileLogin(page);
        await settledHandoff(page);
        await closeLogin(page, true);

        // Ordinary close retains its own focus and scroll restoration policy.
        for (const visibleButton of [true, false]) {
          await page.locator('#mobileMenuBtn').click();
          await expect(page.locator('#mobileNav')).toHaveAttribute('data-state', 'open');
          if (visibleButton) await page.locator('#mobileNavClose').click();
          else await page.keyboard.press('Escape');
          await expect(page.locator('#mobileMenuBtn')).toBeFocused();
          await expect(page.locator('#mobileNav')).toHaveAttribute('data-state', 'closed');
          await expect(page.locator('#mobileMenuBtn')).toBeFocused();
          await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
        }
        expect(state.errors).toEqual([]);
        expect(state.mutations).toEqual([]);
      });
    }

    test('shared pricing header hands login focus back to visible menu control', async ({ page }) => {
      const state = await visit(page, locale, '/pricing.html', 'not-applicable');
      await openMobileLogin(page);
      await settledHandoff(page);
      await closeLogin(page);
      expect(state.errors).toEqual([]);
      expect(state.mutations).toEqual([]);
    });
  });

  test(`desktop login ${locale} retains its trigger and keyboard behavior`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await visit(page, locale, '/', 'dismissed');
    const trigger = page.locator('#navbar .site-nav__cta');
    // macOS WebKit uses Option-Tab to include native buttons/links outside the
    // modal. Establish focus through the browser, without test-only focus calls.
    const navigationKey = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
    await page.keyboard.press(navigationKey);
    for (let index = 0; index < 40 && !await trigger.evaluate(button => button === document.activeElement); index++) {
      await page.keyboard.press(navigationKey);
    }
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.auth-modal__close')).toBeFocused();
    await keyboardContainment(page);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}
