const { test, expect } = require('@playwright/test');

async function mockMemberSubscription(page, action) {
  const user = { id: 'subscription-focus-member', email: 'focus@example.test', role: 'user', status: 'active', has_avatar: false };
  const mutations = [];
  await page.addInitScript(() => {
    localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false }));
    window.__subscriptionFocusOrigins = [];
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-subscription-action]');
      if (button) window.__subscriptionFocusOrigins.push({ target: button.dataset.subscriptionAction,
        active: document.activeElement?.getAttribute('data-subscription-action') || null,
        activeTag: document.activeElement?.tagName || null });
    }, true);
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      let json, status = 200;
      if (url.pathname === '/api/me') json = { loggedIn: true, user };
      else if (url.pathname === '/api/orgs') json = { ok: true, organizations: [] };
      else if (url.pathname === '/api/account/credits-dashboard') json = { ok: true, dashboard: {
        account: { userId: user.id, email: user.email, role: user.role, status: user.status },
        balance: { current: 10000, available: 10000, totalCredits: 10000, subscriptionCredits: 6000, purchasedCredits: 4000, lifetimeConsumed: 0 },
        subscriptionStatus: 'active', subscriptionPeriodStart: '2026-05-01T00:00:00.000Z', subscriptionPeriodEnd: '2026-06-01T00:00:00.000Z',
        activeUntil: '2026-06-01T00:00:00.000Z', hasActiveSubscription: true,
        cancelAtPeriodEnd: action === 'reactivate', canCancelSubscription: action === 'cancel', canReactivateSubscription: action === 'reactivate',
        packs: [], transactions: [], purchaseHistory: [], liveCheckout: { enabled: false, configured: false, mode: 'test' },
      } };
      else { if (route.request().method() !== 'GET') mutations.push({ method: route.request().method(), path: url.pathname }); json = { ok: false, error: 'Synthetic endpoint unavailable' }; status = 404; }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    }
    if (url.origin === 'http://localhost:3000') return route.continue();
    return route.abort('blockedbyclient');
  });
  return mutations;
}

for (const locale of ['en', 'de']) for (const action of ['cancel', 'reactivate']) for (const activation of ['mouse', 'keyboard']) {
  test(`subscription dialog returns to its ${action} trigger after ${activation} activation (${locale})`, async ({ page }, testInfo) => {
    await page.setViewportSize(locale === 'de' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    const mutations = await mockMemberSubscription(page, action);
    await page.goto(`${locale === 'de' ? '/de' : ''}/account/credits.html?scope=member`);
    const trigger = page.locator(`[data-subscription-action="${action}"]`);
    await expect(trigger).toBeVisible();
    if (activation === 'keyboard') { await trigger.focus(); await page.keyboard.press('Enter'); }
    else await trigger.click();
    const dialog = page.locator('#creditsSubscriptionDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-describedby', 'creditsSubscriptionDialogBody');
    const initial = page.locator(action === 'reactivate' ? '#creditsSubscriptionDialogConfirm' : '#creditsSubscriptionDialogCancel');
    await expect(initial).toBeFocused();
    await page.keyboard.press(action === 'reactivate' ? 'Tab' : 'Shift+Tab');
    await expect(page.locator(action === 'reactivate' ? '#creditsSubscriptionDialogCancel' : '#creditsSubscriptionDialogConfirm')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const origins = await page.evaluate(() => window.__subscriptionFocusOrigins);
    await testInfo.attach('synthetic-click-focus-origin', { body: JSON.stringify(origins), contentType: 'application/json' });
    expect(origins[0].target).toBe(action);
    await expect(trigger).toBeFocused();
    // Reopen and use the explicit dialog dismissal, without any billing write.
    await trigger.click(); await expect(dialog).toBeVisible();
    await page.locator('#creditsSubscriptionDialogCancel').click();
    await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
    expect(mutations).toEqual([]);
  });
}
