const { test, expect, MODES, home, openAuth, selectCategory } = require('./helpers/remediation-ui-fixtures');

test.beforeEach(async ({ browser }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-version', description: browser.version() });
});

for (const locale of ['en', 'de']) {
  test.describe(`remediation ${locale}`, () => {
    for (const mode of MODES) {
      test(`UI-02 ${mode.name} manual keyboard tabs preserve guest gate and lazy modules`, async ({ page }) => {
        const requests = [];
        page.on('request', request => requests.push(new URL(request.url()).pathname));
        const state = await home(page, locale);
        await selectCategory(page, mode);
        const explore = page.locator(`[${mode.attr}="explore"]`);
        const create = page.locator(`[${mode.attr}="create"]`);
        await explore.focus();
        await page.keyboard.press('ArrowRight');
        await expect(create).toBeFocused();
        await expect(explore).toHaveAttribute('aria-selected', 'true');
        await expect(create).toHaveAttribute('aria-selected', 'false');
        expect(requests).not.toContain(mode.module);
        await page.keyboard.press('ArrowRight');
        await expect(explore).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(create).toBeFocused();
        await page.keyboard.press('Home');
        await expect(explore).toBeFocused();
        await page.keyboard.press('End');
        await expect(create).toBeFocused();
        await expect(create).toHaveAttribute('tabindex', '0');
        await expect(explore).toHaveAttribute('tabindex', '-1');
        await page.keyboard.press('Enter');
        await expect(page.locator('#authRegisterForm')).toBeVisible();
        await expect(explore).toHaveAttribute('aria-selected', 'true');
        expect(requests).not.toContain(mode.module);
        await page.keyboard.press('Escape');
        await expect(create).toBeFocused();
        await page.keyboard.press('Space');
        await expect(page.locator('#authRegisterForm')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(create).toBeFocused();
        expect(state.mutations).toEqual([]);
        expect(state.errors).toEqual([]);
      });

      test(`UI-02 ${mode.name} member activation exposes the matching panel only on Enter`, async ({ page }) => {
        const requests = [];
        page.on('request', request => requests.push(new URL(request.url()).pathname));
        const state = await home(page, locale, { member: true });
        await selectCategory(page, mode);
        const explore = page.locator(`[${mode.attr}="explore"]`);
        const create = page.locator(`[${mode.attr}="create"]`);
        await explore.focus();
        await page.keyboard.press('End');
        await expect(create).toBeFocused();
        expect(requests).not.toContain(mode.module);
        await page.keyboard.press('Enter');
        await expect(create).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(`#${mode.create}`)).toBeVisible();
        await expect(page.locator(`#${mode.explore}`)).toBeHidden();
        await expect(create).toHaveAttribute('aria-controls', mode.create);
        await expect(page.locator(`#${mode.create}`)).toHaveAttribute('role', 'tabpanel');
        await expect(page.locator(`#${mode.create}`)).toHaveAttribute('aria-labelledby', await create.getAttribute('id'));
        expect(requests.filter(value => value === mode.module)).toHaveLength(1);
        await page.keyboard.press('Home');
        await expect(explore).toBeFocused();
        await page.keyboard.press('Space');
        await expect(explore).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(`#${mode.explore}`)).toBeVisible();
        await expect(page.locator(`#${mode.create}`)).toBeHidden();
        expect(requests.filter(value => value === mode.module)).toHaveLength(1);
        expect(state.mutations).toEqual([]);
        expect(state.errors).toEqual([]);
      });
    }

  });
}
