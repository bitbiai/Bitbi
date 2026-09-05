const { test, expect, MODES, home, openAuth, selectCategory } = require('./helpers/remediation-ui-fixtures');

test.beforeEach(async ({ browser }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-version', description: browser.version() });
});

for (const locale of ['en', 'de']) {
  test.describe(`remediation ${locale}`, () => {
    test('UI-03 closed Gallery dialog rejects focus, and keyboard open/close restores its card', async ({ page }) => {
      const state = await home(page, locale);
      await selectCategory(page, MODES[0]);
      const card = page.locator('#galleryGrid .gallery-item').first();
      const modal = page.locator('#galleryModal');
      const close = modal.locator('.modal-close');
      const first = modal.locator('#modalFullLink');
      await expect(card).toBeVisible();
      await card.focus();
      await close.evaluate(node => node.focus());
      await expect(card).toBeFocused();
      await expect(modal).toHaveAttribute('aria-hidden', 'true');
      for (let cycle = 0; cycle < 2; cycle++) {
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(modal).toHaveClass(/active/);
        await expect(modal).toHaveAttribute('aria-hidden', 'false');
        await expect(first).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        expect(await page.evaluate(() => !!document.activeElement.closest('#galleryModal'))).toBe(true);
        await page.keyboard.press('Tab');
        await expect(first).toBeFocused();
        if (cycle === 0) await page.keyboard.press('Escape');
        else await close.click();
        await expect(modal).not.toHaveClass(/active/);
        await expect(card).toBeFocused();
        await close.evaluate(node => node.focus());
        await expect(card).toBeFocused();
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement.closest('#galleryModal'))).toBe(false);
        // Existing click suppression prevents an accidental re-open for 400 ms.
        await page.waitForTimeout(450);
      }
      expect(state.mutations).toEqual([]);
      expect(state.errors).toEqual([]);
    });

  });
}
