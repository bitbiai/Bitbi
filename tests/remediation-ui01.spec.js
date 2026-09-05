const { test, expect, MODES, home, openAuth, selectCategory } = require('./helpers/remediation-ui-fixtures');

test.beforeEach(async ({ browser }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-version', description: browser.version() });
});

for (const locale of ['en', 'de']) {
  test.describe(`remediation ${locale}`, () => {
    test('UI-01 closed auth shell stays outside focus order before opening and after closing', async ({ page }) => {
      const state = await home(page, locale);
      await page.evaluate(() => {
        const host = document.getElementById('authModal');
        const before = document.createElement('button'); before.id = 'beforeAuthFixture'; before.textContent = 'Before auth'; before.tabIndex = 0;
        const after = document.createElement('button'); after.id = 'afterAuthFixture'; after.textContent = 'After auth'; after.tabIndex = 0;
        host.before(before); host.after(after);
      });
      const before = page.locator('#beforeAuthFixture');
      const after = page.locator('#afterAuthFixture');
      const close = page.locator('.auth-modal__close');
      const assertClosedOrder = async () => {
        await before.focus();
        await close.evaluate(node => node.focus());
        await expect(before).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(after).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(before).toBeFocused();
      };
      await assertClosedOrder();
      for (const tab of ['login', 'register']) {
        await before.focus();
        await openAuth(page, tab);
        await expect(close).toBeFocused();
        if (tab === 'login') await close.click();
        else await page.keyboard.press('Escape');
        await expect(before).toBeFocused();
        await assertClosedOrder();
      }
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });

    test('UI-01 auth keyboard containment, form switching and repeated close/restore', async ({ page }) => {
      const state = await home(page, locale);
      const trigger = page.locator('#navbar [data-category-link="video"]');
      for (let cycle = 0; cycle < 2; cycle++) {
        await trigger.focus();
        await openAuth(page);
        await openAuth(page); // Repeated requests must not leave an orphan trap.
        const close = page.locator('.auth-modal__close');
        const lastLogin = page.locator('#authLoginForm a');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(lastLogin).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        for (const selector of [
          '.auth-modal__tab[data-tab="login"]', '.auth-modal__tab[data-tab="register"]',
          '#authLoginForm input[type="email"]', '#authLoginForm input[type="password"]',
          '#authLoginForm button[type="submit"]', '#authWalletLoginBtn', '#authLoginForm a', '.auth-modal__close',
        ]) {
          await page.keyboard.press('Tab');
          await expect(page.locator(selector)).toBeFocused();
        }
        await page.locator('.auth-modal__tab[data-tab="register"]').click();
        await close.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('#authRegisterForm button[type="submit"]')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        for (const selector of [
          '.auth-modal__tab[data-tab="login"]', '.auth-modal__tab[data-tab="register"]',
          '#authRegisterForm input[type="email"]', '#authRegisterForm input[type="password"]',
          '#authRegisterForm button[type="submit"]', '.auth-modal__close',
        ]) {
          await page.keyboard.press('Tab');
          await expect(page.locator(selector)).toBeFocused();
        }
        if (cycle === 0) await page.keyboard.press('Escape');
        else await close.click();
        await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
        await expect(trigger).toBeFocused();
        await expect(page.locator('#authLoginForm')).toHaveCount(0);
        await expect(page.locator('#authRegisterForm')).toHaveCount(0);
      }
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });

    test('UI-01 auth fields retain localized accessible names and message descriptions', async ({ page }) => {
      await home(page, locale);
      for (const tab of ['login', 'register']) {
        await openAuth(page, tab);
        const form = page.locator(tab === 'login' ? '#authLoginForm' : '#authRegisterForm');
        for (const type of ['email', 'password']) {
          const input = form.locator(`input[type="${type}"]`);
          const placeholder = await input.getAttribute('placeholder');
          await expect(input).toHaveAccessibleName(placeholder);
          expect(await input.evaluate(node => !!node.getAttribute('aria-label') || node.labels.length > 0)).toBe(true);
          await input.fill(type === 'email' ? 'keyboard@example.invalid' : 'disposable-password');
          await expect(input).toHaveAccessibleName(placeholder);
          await expect(input).toHaveAttribute('aria-describedby', tab === 'login' ? 'authLoginMsg' : 'authRegisterMsg');
        }
        await expect(page.locator('.auth-modal__overlay')).toHaveAttribute('role', 'dialog');
        await expect(page.locator('.auth-modal__overlay')).toHaveAttribute('aria-modal', 'true');
        await page.keyboard.press('Escape');
      }
    });

    test('UI-01 pending login disables submission and dynamic errors remain keyboard reachable', async ({ page }) => {
      const state = await home(page, locale);
      const expectedCalls = [];
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/api/login', async route => {
        expectedCalls.push(route.request().method());
        await gate;
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Local unverified-email fixture', code: 'EMAIL_NOT_VERIFIED' }) });
      });
      await openAuth(page);
      await page.locator('#authLoginForm input[type="email"]').fill('keyboard@example.invalid');
      await page.locator('#authLoginForm input[type="password"]').fill('disposable-password');
      const submit = page.locator('#authLoginForm button[type="submit"]');
      try {
        await submit.click();
        await expect(submit).toBeDisabled();
        await page.locator('#authLoginForm input[type="password"]').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#authWalletLoginBtn')).toBeFocused();
      } finally {
        release();
      }
      await expect(submit).toBeEnabled();
      await expect(page.locator('#authLoginMsg')).toContainText('Local unverified-email fixture');
      await page.locator('.auth-modal__tab[data-tab="register"]').focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('#authLoginMsg a')).toBeFocused();
      await page.locator('.auth-modal__close').focus();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#authLoginForm > p a')).toBeFocused();
      await page.keyboard.press('Escape');
      expect(expectedCalls).toEqual(['POST']);
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 390, height: 450 },
    ]) {
      test(`UI-01 floating Close is visible and clickable with scrollable forms at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const state = await home(page, locale);
        await page.evaluate(() => document.fonts.ready);
        const close = page.locator('.auth-modal__close');
        const card = page.locator('.auth-modal__card');
        const closeIsHitTarget = () => close.evaluate(button => {
          const rect = button.getBoundingClientRect();
          const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth
            && (top === button || button.contains(top));
        });
        for (const tab of ['login', 'register']) {
          await openAuth(page, tab);
          await expect.poll(closeIsHitTarget).toBe(true);
          if (viewport.height === 450) {
            expect(await card.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
            await card.evaluate(node => { node.scrollTop = node.scrollHeight; });
            expect(await card.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
            await expect.poll(closeIsHitTarget).toBe(true);
          }
          await close.click();
          await expect(page.locator('.auth-modal__overlay')).not.toHaveClass(/active/);
        }
        expect(state.mutations).toEqual([]);
        expect(state.errors).toEqual([]);
      });
    }

    test('shared trap preserves native media Tab handling', async ({ page }, info) => {
      await home(page, locale);
      const observations=[];
      for (const tag of ['video','audio']) {
        await page.evaluate(async tag => {
          const {setupFocusTrap}=await import('/js/shared/focus-trap.js');
          const host=document.createElement('div');host.id='nativeMediaFixture';host.setAttribute('role','dialog');host.setAttribute('aria-label','Local native media fixture');
          const first=document.createElement('button');first.id='nativeMediaFirst';first.textContent='Before media';first.tabIndex=0;
          const media=document.createElement(tag);media.id='nativeMediaControl';media.controls=true;media.preload='none';
          const last=document.createElement('button');last.id='nativeMediaLast';last.textContent='After media';last.tabIndex=0;
          host.append(first,media,last);document.body.append(host);
          window.nativeMediaCleanup=setupFocusTrap(host);media.focus();
          window.nativeMediaKeyPrevented=null;
          document.addEventListener('keydown',event=>{window.nativeMediaKeyPrevented=event.defaultPrevented;},{capture:true,once:true});
        },tag);
        await expect(page.locator('#nativeMediaControl')).toBeFocused();
        await page.keyboard.press('Tab');
        const observation=await page.evaluate(()=>({prevented:window.nativeMediaKeyPrevented,activeId:document.activeElement.id,activeTag:document.activeElement.tagName}));
        observations.push({tag,...observation});
        expect(observation.prevented).toBe(false);
        expect(observation.activeId).not.toBe('nativeMediaFirst');
        await page.locator('#nativeMediaLast').focus();await page.keyboard.press('Tab');await expect(page.locator('#nativeMediaFirst')).toBeFocused();
        await page.evaluate(()=>{window.nativeMediaCleanup();document.getElementById('nativeMediaFixture').remove();});
      }
      await info.attach('native-media-tab',{body:JSON.stringify(observations,null,2),contentType:'application/json'});
    });

    test('shared trap handles hidden, disabled, inert, dynamic and empty controls', async ({ page }) => {
      await home(page, locale);
      await page.evaluate(async () => {
        const { setupFocusTrap } = await import('/js/shared/focus-trap.js');
        const host = document.createElement('div');
        const append = (parent, tag, text, attributes = {}) => {
          const node = document.createElement(tag);
          node.textContent = text;
          for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
          parent.append(node);
          return node;
        };
        append(host, 'button', 'Open fixture', { id: 'trapTrigger' });
        const dialog = append(host, 'div', '', { id: 'trapFixture', role: 'dialog', 'aria-label': 'Disposable focus fixture' });
        append(dialog, 'button', 'First', { id: 'first' });
        append(dialog, 'button', 'Hidden', { hidden: '' });
        append(append(dialog, 'div', '', { style: 'display:none' }), 'button', 'Hidden parent');
        append(dialog, 'button', 'Disabled', { disabled: '' });
        append(append(dialog, 'fieldset', '', { disabled: '' }), 'button', 'Disabled fieldset');
        append(dialog, 'button', 'Programmatic only', { tabindex: '-1' });
        append(append(dialog, 'div', '', { inert: '' }), 'a', 'Inert', { href: '#' });
        append(dialog, 'button', 'Invisible', { style: 'visibility:hidden' });
        append(dialog, 'a', 'Last', { id: 'last', href: '#' });
        document.body.append(host);
        document.getElementById('trapTrigger').focus();
        window.fixtureTrapCleanup = setupFocusTrap(document.getElementById('trapFixture'));
      });
      await expect(page.locator('#first')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#last')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('#first')).toBeFocused();
      await page.evaluate(() => {
        document.getElementById('last').hidden = true;
        const next = document.createElement('button');
        next.id = 'dynamicLast'; next.textContent = 'Dynamically added';
        document.getElementById('trapFixture').append(next);
      });
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#dynamicLast')).toBeFocused();
      await page.evaluate(() => { document.getElementById('dynamicLast').disabled = true; });
      await page.keyboard.press('Tab');
      await expect(page.locator('#first')).toBeFocused();
      await page.evaluate(() => document.getElementById('first').remove());
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement === document.getElementById('trapFixture'))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => document.activeElement === document.getElementById('trapFixture'))).toBe(true);
      await page.evaluate(() => { window.fixtureTrapCleanup(); window.fixtureTrapCleanup(); });
      await expect(page.locator('#trapTrigger')).toBeFocused();
      await expect(page.locator('#trapFixture')).not.toHaveAttribute('tabindex');
    });

    test('shared trap preserves the supported mobile grid/detail overlay stack', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await home(page, locale);
      await page.evaluate(async () => {
        const mainScript = document.querySelector('script[type="module"][src*="/pages/index/main.js"]');
        const version = new URL(mainScript.src).searchParams.get('v');
        const { openMobileMediaGrid } = await import(`/js/shared/mobile-media-grid-overlay.js${version ? `?v=${encodeURIComponent(version)}` : ''}`);
        const trigger = document.createElement('button'); trigger.id = 'gridFixtureTrigger'; trigger.textContent = 'Open local grid'; document.body.append(trigger); trigger.focus();
        openMobileMediaGrid({ title: 'Disposable local grid', items: [{ id: 'fixture' }], renderItem(item, index, { openDetail }) {
          const button = document.createElement('button'); button.id = 'gridFixtureItem'; button.textContent = 'Open detail';
          button.addEventListener('click', () => openDetail({ title: 'Disposable local detail', renderContent() { const action = document.createElement('button'); action.id = 'detailFixtureAction'; action.textContent = 'Local action'; return action; } }));
          return button;
        } });
      });
      await expect(page.locator('.mobile-media-grid-overlay__close')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#gridFixtureItem')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.mobile-media-detail-overlay__close')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#detailFixtureAction')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('.mobile-media-detail-overlay__close')).toBeFocused();
      // Its supported Back button closes only the nested detail.
      await page.locator('.mobile-media-detail-overlay__close').click();
      await expect(page.locator('.mobile-media-detail-overlay')).toHaveCount(0);
      await expect(page.locator('.mobile-media-grid-overlay__close')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#gridFixtureItem')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator('.mobile-media-grid-overlay')).toHaveCount(0);
      await expect(page.locator('#gridFixtureTrigger')).toBeFocused();
    });
  });
}
