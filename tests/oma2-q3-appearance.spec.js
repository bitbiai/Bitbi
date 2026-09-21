const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { setupAppearance } = require('./helpers/appearance');

const appearance = page => page.locator('#sectionAppearance');
const choice = (page, segment, value) => appearance(page).locator(`input[name="${segment}"][value="${value}"]`);
async function openAppearance(page) {
    await page.goto('/admin/index.html#appearance');
    await expect(appearance(page).locator('fieldset')).toHaveCount(5);
    await expect(appearance(page).locator('.appearance__state')).toHaveText('Saved');
}

for (const [locale, width] of [['en', 1440], ['de', 390]]) test.describe(`${locale} appearance Admin controls`, () => {
    test.use({ hasTouch: width < 500 });
    test('scoped draft, cancel, saved revision, reload and initial defaults work by keyboard/touch', async ({ page, baseURL }, info) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await setupAppearance(page, baseURL);
        await openAppearance(page);
        if (locale === 'de') await appearance(page).getByLabel('Appearance language').selectOption('de');
        const labels = locale === 'de' ? { save: 'Änderungen speichern', cancel: 'Abbrechen', reset: 'Auf ursprüngliche Standardwerte zurücksetzen' } : { save: 'Save changes', cancel: 'Cancel', reset: 'Reset to initial defaults' };
        const choose = async (segment, value) => {
            const radio = choice(page, segment, value);
            if (width < 500) await radio.tap(); else { await radio.focus(); await radio.press('Space'); }
        };
        await choose('canvas', 'light');
        await expect(appearance(page).locator('.appearance__changes')).toContainText(locale === 'de' ? 'Canvas: Dunkel → Hell' : 'Canvas: Dark → Light');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await appearance(page).getByRole('button', { name: labels.cancel, exact: true }).click();
        await expect(choice(page, 'canvas', 'dark')).toBeChecked();
        expect(state.calls.filter(call => call.method === 'PATCH')).toEqual([]);
        await choose('canvas', 'light');
        await choose('admin', 'light');
        await appearance(page).getByRole('button', { name: labels.save, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(appearance(page).locator('.appearance__state')).toHaveText(locale === 'de' ? 'Gespeichert' : 'Saved');
        expect(state.appearance).toMatchObject({ revision: 1, personalEnabled: false, segments: { public: 'dark', admin: 'light', generateLab: 'dark', canvas: 'light', account: 'dark' } });
        const write = state.calls.find(call => call.method === 'PATCH');
        expect(write).toMatchObject({ pathname: '/api/admin/appearance', body: { revision: 0, segments: state.appearance.segments } });
        expect(Object.keys(write.body)).toEqual(['revision', 'segments']);
        await page.reload();
        await expect(choice(page, 'canvas', 'light')).toBeChecked();
        await expect(choice(page, 'admin', 'light')).toBeChecked();
        if (locale === 'de') await appearance(page).getByLabel('Appearance language').selectOption('de');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(info.outputDir, `${locale}-${width}-appearance-light.png`), fullPage: true, animations: 'disabled' });
        await appearance(page).getByRole('button', { name: labels.reset, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        expect(state.appearance.revision).toBe(1);
        await appearance(page).getByRole('button', { name: labels.save, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(state.appearance.revision).toBe(2);
        expect(Object.values(state.appearance.segments)).toEqual(['dark', 'dark', 'dark', 'dark', 'dark']);
        await page.screenshot({ path: path.join(info.outputDir, `${locale}-${width}-appearance-dark.png`), fullPage: true, animations: 'disabled' });
        expect(state.errors).toEqual([]); expect(state.unexpectedWrites).toEqual([]);
    });
});

test('appearance conflict and failed save retain draft without claiming success or changing the page theme', async ({ page, baseURL }) => {
    const state = await setupAppearance(page, baseURL);
    await openAppearance(page);
    await choice(page, 'canvas', 'light').check();
    state.change({ public: 'light' });
    await appearance(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(appearance(page).getByRole('alert')).toContainText('newer settings');
    await expect(choice(page, 'canvas', 'light')).toBeChecked();
    expect(state.appearance.segments.canvas).toBe('dark');
    await expect(appearance(page).getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await appearance(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(choice(page, 'public', 'light')).toBeChecked();
    await expect(choice(page, 'canvas', 'dark')).toBeChecked();
    state.saveFailure = 503;
    await choice(page, 'admin', 'light').check();
    await appearance(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(appearance(page).getByRole('alert')).toContainText('not confirmed');
    await expect(choice(page, 'admin', 'light')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(state.appearance.revision).toBe(1); expect(state.appearance.segments.admin).toBe('dark');
    expect(state.errors).toEqual([]);
});

for (const [role, adminGate] of [['anonymous', 401], ['user', 403], ['admin', 428]]) test(`appearance protected editing denies ${adminGate} while public theme remains available`, async ({ page, baseURL }) => {
    const state = await setupAppearance(page, baseURL, { role, adminGate, segments: { admin: 'light' } });
    await page.goto('/admin/index.html#appearance');
    await expect(page.locator('#adminDenied')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(state.calls.filter(call => call.pathname === '/api/admin/appearance')).toEqual([]);
    await expect(appearance(page).locator('input')).toHaveCount(0);
    expect(state.unexpectedWrites).toEqual([]);
});

// One compact matrix per engine: real pages, public/member/Admin identities,
// both paints, alternating EN/DE and viewport sizes. No product mutations.
for (const entry of [
    { segment: 'public', route: '/', role: 'anonymous', width: 1440, ready: '#navbar', surface: 'body' },
    { segment: 'admin', route: '/admin/index.html#appearance', role: 'admin', width: 1440, ready: '#sectionAppearance fieldset', surface: '.appearance__segment' },
    { segment: 'generateLab', route: '/de/generate-lab/', role: 'user', width: 1440, ready: '#labPrompt', surface: '#labPrompt' },
    { segment: 'canvas', route: '/de/canvas/', role: 'user', width: 390, ready: '#canvasProjectTitle', surface: '.canvas-topbar' },
    { segment: 'account', route: '/de/account/forgot-password.html', role: 'anonymous', width: 390, ready: '#emailInput', surface: '#emailInput' },
]) test(`appearance ${entry.segment} paints both themes without replacing active UI or leaking across segments`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width: entry.width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    const state = await setupAppearance(page, baseURL, { role: entry.role });
    await page.goto(entry.route);
    await expect(page.locator(entry.ready).first()).toBeVisible();
    if (entry.segment === 'canvas') await expect(page.locator('#canvasProjectTitle')).toHaveValue('Theme fixture');
    await expect(page.locator('html')).toHaveAttribute('data-theme-segment', entry.segment);
    const typed = entry.segment === 'generateLab' ? page.locator('#labPrompt') : entry.segment === 'account' ? page.locator('#emailInput') : null;
    if (typed) await typed.fill(entry.segment === 'account' ? 'unsent@example.invalid' : 'Keep this unsent creative draft');
    const before = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('.canvas-node')].map(el => ({ id: el.dataset.nodeId, transform: el.style.transform })) }));
    const colors = [];
    for (const theme of ['dark', 'light']) {
        state.change({ [entry.segment]: theme });
        await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
        expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe(theme === 'light' ? '#f1f5f7' : '#0A0A0A');
        const paint = () => page.locator(entry.surface).first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
        if (theme === 'light') await expect.poll(paint).not.toEqual(colors[0]);
        colors.push(await paint());
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (typed) await expect(typed).toHaveValue(entry.segment === 'account' ? 'unsent@example.invalid' : 'Keep this unsent creative draft');
        await page.screenshot({ path: path.join(info.outputDir, `${entry.segment}-${theme}-${entry.width}.png`), fullPage: true, animations: 'disabled' });
    }
    expect(colors[0]).not.toEqual(colors[1]);
    expect(await page.evaluate(() => [...document.querySelectorAll('.canvas-node')].map(el => ({ id: el.dataset.nodeId, transform: el.style.transform })))).toEqual(before.nodes);
    const confirmed = await page.evaluate(() => window.BitbiAppearance.snapshot());
    for (const [segment, value] of Object.entries(confirmed.segments)) expect(value).toBe(segment === entry.segment ? 'light' : 'dark');
    expect(state.calls.filter(call => call.method !== 'GET')).toEqual([]);
    expect(state.unexpectedWrites).toEqual([]); expect(state.errors).toEqual([]);
});

test('appearance shared help and Assets Manager inherit Generate Lab, with keyboard focus and draft preserved', async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await setupAppearance(page, baseURL, { role: 'user', segments: { generateLab: 'light', account: 'dark' } });
    await page.goto('/generate-lab/');
    await expect(page.locator('#labPrompt')).toBeVisible();
    await page.locator('#labPrompt').fill('Keep the generation draft');
    const help = page.locator('.help-menu__trigger');
    await help.focus(); await help.press('Enter');
    await expect(page.locator('.help-menu__panel')).toBeVisible();
    const lightHelp = await page.locator('.help-menu__panel').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.keyboard.press('Escape'); await expect(help).toBeFocused();
    await page.locator('#labAssetsOpen').first().click();
    await expect(page.locator('#labAssetsOverlay')).toBeVisible();
    await expect(page.locator('#labAssetsFolderGrid')).toContainText('Theme examples');
    const panel = page.locator('.generate-lab-assets-overlay__shell');
    const lightPanel = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
    state.change({ generateLab: 'dark' });
    await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
    await expect(page.locator('#labAssetsOverlay')).toBeVisible();
    expect(await panel.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(lightPanel);
    await page.screenshot({ path: path.join(info.outputDir, 'host-dark-assets-overlay.png'), fullPage: true, animations: 'disabled' });
    await page.locator('#labAssetsOverlayClose').click();
    await expect(page.locator('#labPrompt')).toHaveValue('Keep the generation draft');
    await help.click();
    expect(await page.locator('.help-menu__panel').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(lightHelp);
    expect(state.unexpectedWrites).toEqual([]); expect(state.errors).toEqual([]);
});

test('appearance propagates to another open session, ignores stale responses and preserves Canvas state across resume', async ({ page, browser, baseURL }) => {
    const state = await setupAppearance(page, baseURL, { role: 'user' });
    await page.clock.install();
    await page.goto('/canvas/');
    await expect(page.locator('#canvasProjectTitle')).toHaveValue('Theme fixture');
    await expect(page.locator('.canvas-node')).toHaveCount(2);
    await page.locator('.canvas-node').first().press('Enter');
    const selected = await page.locator('.canvas-node.is-selected').getAttribute('data-node-id');
    const otherContext = await browser.newContext({ baseURL });
    try {
        const other = await otherContext.newPage();
        const remote = await setupAppearance(other, baseURL, { appearance: state.appearance });
        await other.goto('/admin/index.html#appearance');
        await expect(appearance(other).locator('fieldset')).toHaveCount(5);
        await choice(other, 'canvas', 'light').check();
        await appearance(other).getByRole('button', { name: 'Save changes', exact: true }).click();
        await expect(appearance(other).locator('.appearance__state')).toHaveText('Saved');
        state.appearance = remote.appearance;
        await page.clock.fastForward(60_000);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        const hold = state.holdPublic();
        const oldRead = page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
        await hold.requested;
        state.change({ canvas: 'dark' });
        // A newer confirmed Admin response arrives while an older GET is in flight.
        await page.evaluate(value => window.BitbiAppearance.acceptConfirmed(value), state.appearance);
        hold.release(); await oldRead;
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(await page.evaluate(() => window.BitbiAppearance.snapshot().revision)).toBe(2);
        state.change({ canvas: 'light' });
        await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(page.locator('#canvasProjectTitle')).toHaveValue('Theme fixture');
        await expect(page.locator('.canvas-node.is-selected')).toHaveAttribute('data-node-id', selected);
        expect(state.calls.filter(call => call.method !== 'GET')).toEqual([]);
        expect(state.errors).toEqual([]);
    } finally { await otherContext.close(); }
});

test('appearance cold failure is bounded; navigation, reload and nested routes use global settings, never personal or OS values', async ({ page, baseURL }) => {
    const state = await setupAppearance(page, baseURL, { role: 'anonymous' });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.addInitScript(() => {
        localStorage.setItem('theme', 'light'); localStorage.setItem('bitbi_theme', 'light');
        localStorage.setItem('bitbi.appearance.personal.v1', JSON.stringify({ version: 1, theme: 'light' }));
    });
    state.publicFailure = 503;
    await page.clock.install();
    const cold = state.holdPublic();
    await page.goto('/de/account/forgot-password.html?theme=light');
    await cold.requested;
    await expect(page.locator('html')).toHaveAttribute('data-appearance-pending', '');
    await page.clock.fastForward(600);
    await expect(page.locator('#emailInput')).toBeVisible();
    cold.release();
    await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#emailInput')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-appearance-pending');
    state.publicFailure = 0; state.change({ account: 'light', public: 'dark' });
    await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.goto('/de/legal/privacy.html?theme=light');
    await expect(page.locator('html')).toHaveAttribute('data-theme-segment', 'public');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    state.publicFailure = 503;
    await page.goto('/account/forgot-password.html?theme=dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#emailInput')).toBeVisible();
    // Disk cache may not overrule a fresh server response, even with a bogus revision.
    await page.evaluate(() => localStorage.setItem('bitbi.appearance.global.v1', JSON.stringify({ ...window.BitbiAppearance.snapshot(), revision: 999, segments: { public: 'dark', admin: 'dark', generateLab: 'dark', canvas: 'dark', account: 'dark' } })));
    state.publicFailure = 0;
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => window.BitbiAppearance.snapshot().revision)).toBe(state.appearance.revision);
    expect(state.unexpectedWrites).toEqual([]); expect(state.errors).toEqual([]);
});
