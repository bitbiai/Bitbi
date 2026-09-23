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
        await choose('admin', 'soft');
        await appearance(page).getByRole('button', { name: labels.save, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft');
        await expect(appearance(page).locator('.appearance__state')).toHaveText(locale === 'de' ? 'Gespeichert' : 'Saved');
        expect(state.appearance).toMatchObject({ revision: 1, personalEnabled: false, segments: { public: 'dark', admin: 'soft', generateLab: 'dark', canvas: 'light', account: 'dark' } });
        const write = state.calls.find(call => call.method === 'PATCH');
        expect(write).toMatchObject({ pathname: '/api/admin/appearance', body: { revision: 0, segments: state.appearance.segments } });
        expect(Object.keys(write.body)).toEqual(['revision', 'segments']);
        await page.reload();
        await expect(choice(page, 'canvas', 'light')).toBeChecked();
        await expect(choice(page, 'admin', 'soft')).toBeChecked();
        if (locale === 'de') await appearance(page).getByLabel('Appearance language').selectOption('de');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(info.outputDir, `${locale}-${width}-appearance-soft.png`), fullPage: true, animations: 'disabled' });
        await appearance(page).getByRole('button', { name: labels.reset, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft');
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
// all three paints, alternating EN/DE and viewport sizes. No product mutations.
for (const entry of [
    { segment: 'public', route: '/', role: 'anonymous', width: 1440, ready: '#navbar', surface: 'body' },
    { segment: 'admin', route: '/admin/index.html#appearance', role: 'admin', width: 1440, ready: '#sectionAppearance fieldset', surface: '.appearance__segment' },
    { segment: 'generateLab', route: '/de/generate-lab/', role: 'user', width: 1440, ready: '#labPrompt', surface: '#labPrompt' },
    { segment: 'canvas', route: '/de/canvas/', role: 'user', width: 390, ready: '#canvasProjectTitle', surface: '.canvas-topbar' },
    { segment: 'account', route: '/de/account/forgot-password.html', role: 'anonymous', width: 390, ready: '#emailInput', surface: '#emailInput' },
]) test(`appearance ${entry.segment} paints all three themes without replacing active UI or leaking across segments`, async ({ page, baseURL }, info) => {
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
    for (const theme of ['dark', 'light', 'soft']) {
        state.change({ [entry.segment]: theme });
        await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('html')).toHaveCSS('color-scheme', theme === 'dark' ? 'dark' : 'light');
        expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe(theme === 'soft' ? '#f3f0e8' : theme === 'light' ? '#f1f5f7' : '#0A0A0A');
        const paint = () => page.locator(entry.surface).first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
        if (theme !== 'dark') await expect.poll(paint).not.toEqual(colors[colors.length - 1]);
        colors.push(await paint());
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (typed) await expect(typed).toHaveValue(entry.segment === 'account' ? 'unsent@example.invalid' : 'Keep this unsent creative draft');
        await page.screenshot({ path: path.join(info.outputDir, `${entry.segment}-${theme}-${entry.width}.png`), fullPage: true, animations: 'disabled' });
    }
    expect(new Set(colors.map(color => JSON.stringify(color))).size).toBe(3);
    expect(await page.evaluate(() => [...document.querySelectorAll('.canvas-node')].map(el => ({ id: el.dataset.nodeId, transform: el.style.transform })))).toEqual(before.nodes);
    const confirmed = await page.evaluate(() => window.BitbiAppearance.snapshot());
    for (const [segment, value] of Object.entries(confirmed.segments)) expect(value).toBe(segment === entry.segment ? 'soft' : 'dark');
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
        await choice(other, 'canvas', 'soft').check();
        await appearance(other).getByRole('button', { name: 'Save changes', exact: true }).click();
        await expect(appearance(other).locator('.appearance__state')).toHaveText('Saved');
        state.appearance = remote.appearance;
        await page.clock.fastForward(60_000);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft');
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

for (const [locale, width] of [['en', 1440], ['de', 390]]) test.describe(`${locale} appearance populated media`, () => {
    test.use({ hasTouch: width < 500 });
    test('light variants preserve decoded previews, accessible actions and the active player', async ({ page, baseURL }, info) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await setupAppearance(page, baseURL, { role: 'user', media: true, segments: { account: 'light' } });
        await page.goto(`${locale === 'de' ? '/de' : ''}/account/assets-manager.html`);
        await expect(page.locator('#studioViewShowAll')).toBeVisible();
        // Visibility does not imply painted opacity: the card has a 700ms reveal.
        // Settle its ancestor before starting the transient notice's lifetime.
        await expect(page.locator('#studioSavedAssetsCard')).toHaveCSS('opacity', '1');
        await page.locator('#studioViewShowAll').click();
        const cards = page.locator('.studio__image-item--visual');
        await expect(cards).toHaveCount(3);
        // Measure the real success notice while shown, not during its deliberate
        // transient-dismissal fade halfway through the later media interactions.
        const notice = page.locator('#studioGalleryMsg');
        await expect(notice).not.toBeEmpty(); await expect(notice).toHaveCSS('opacity', '1');
        const noticePaint = await require('./helpers/appearance').measureContrast(notice);
        expect(noticePaint).toHaveLength(1); expect(noticePaint[0].ratio).toBeGreaterThanOrEqual(4.5);
        const metrics = [{ notice: noticePaint }];
        for (const theme of ['light', 'soft']) {
            state.change({ account: theme }); await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            const text = await require('./helpers/appearance').measureContrast(page.locator('.assets-manager__list-status,.studio__folder-back-btn,.browse-pagination__status'));
            expect(text.length).toBeGreaterThan(0);
            for (const value of text) expect(value.ratio, JSON.stringify(value)).toBeGreaterThanOrEqual(4.5);
            metrics.push({ theme, text });
            for (let index = 0; index < 3; index++) {
                const card = cards.nth(index);
                if (width < 500) {
                    const dot = page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot').nth(index);
                    await dot.tap(); await expect(dot).toHaveAttribute('aria-selected', 'true');
                    // A touchstart snaps the deck transition to its endpoint.
                    // Wait for the selected card's actual settled geometry so
                    // the tap lands on the same button at touchstart/touchend.
                    await expect(card).toHaveCSS('opacity', '1');
                    await expect(card).toHaveCSS('transform', 'matrix(0.9, 0, 0, 0.9, 0, 0)');
                }
                const picture = card.locator('img').first(); await expect(picture).toBeVisible();
                await expect.poll(() => picture.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
                await expect(picture).toHaveCSS('filter', 'none'); await expect(picture).toHaveCSS('opacity', '1');
                await expect(card).toHaveAttribute('title', state.assets[index].title);
                const menu = card.locator('.studio__card-menu');
                if (width < 500) await menu.tap(); else { await menu.focus(); await menu.press('Enter'); }
                await expect(menu).toHaveAttribute('aria-expanded', 'true');
                await expect(card.locator('.studio__card-actions')).toHaveCSS('opacity', '1');
                for (const paint of await require('./helpers/appearance').measureContrast(card.locator('.studio__card-actions button'))) expect(paint.ratio, JSON.stringify(paint)).toBeGreaterThanOrEqual(4.5);
                expect(await card.evaluate(el => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll('.studio__card-actions button')].every(b => { const q = b.getBoundingClientRect(); return q.left >= r.left && q.right <= r.right && q.top >= r.top && q.bottom <= r.bottom && q.width >= 44 && q.height >= 44; }); })).toBe(true);
                if (index === 1) await page.screenshot({ path: info.outputPath(`assets-${locale}-${theme}.png`), fullPage: true });
                if (width < 500) await menu.tap(); else { await menu.focus(); await menu.press('Enter'); }
                await expect(menu).toHaveAttribute('aria-expanded', 'false');
            }
        }
        expect(state.calls.filter(call => call.pathname.endsWith('/file'))).toEqual([]);
        const video = cards.nth(1);
        if (width < 500) await page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot').nth(1).tap();
        await video.locator('.studio__asset-video-trigger').click();
        const videoDialog = page.locator(width < 500 ? '.mobile-media-detail-overlay' : '#studioImageModal.active'); await expect(videoDialog).toBeVisible();
        const player = videoDialog.locator('video'); await expect(player).toHaveAttribute('controls', '');
        await player.evaluate(v => v.play());
        await expect.poll(() => player.evaluate(v => v.videoWidth > 0 && v.readyState >= 2 && !v.error)).toBe(true);
        await expect(player).toHaveAttribute('src', state.assets[1].file_url);
        const videoElement = await player.elementHandle();
        await page.keyboard.press('Escape'); await expect(videoDialog).toHaveCount(0);
        expect(await videoElement.evaluate(v => v.paused && !v.hasAttribute('src'))).toBe(true);
        if (width < 500) await page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot').nth(2).tap();
        // Theme propagation changes paint, never the actual playing element/source.
        const sound = cards.nth(2); await sound.locator('.studio__asset-video-trigger').click();
        const dialog = page.locator('.mobile-media-detail-overlay'); await expect(dialog).toBeVisible();
        const audio = dialog.locator('audio'); await expect(audio).toHaveAttribute('controls', '');
        await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
        const element = await audio.elementHandle(), source = await audio.getAttribute('src');
        state.change({ account: 'dark' }); await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
        expect(await element.evaluate(a => a.isConnected && !a.paused)).toBe(true); await expect(audio).toHaveAttribute('src', source);
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
        expect(await element.evaluate(a => a.paused && !a.hasAttribute('src'))).toBe(true);
        await expect(sound.locator('.studio__asset-video-trigger')).toBeFocused();
        expect(state.unexpectedWrites).toEqual([]); expect(state.errors).toEqual([]);
        await info.attach('rendered-contrast', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
    });
});

test('appearance light variants render loaded Admin video choices with readable selected, focus and input states', async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await setupAppearance(page, baseURL, { segments: { admin: 'light' } });
    await page.goto('/admin/index.html#ai-lab');
    await page.locator('[data-ai-mode="video"]').click();
    const choices = page.locator('.admin-ai__video-model-card'); await expect(choices.first()).toBeVisible();
    expect(await choices.count()).toBeGreaterThan(1);
    const metrics = [];
    for (const theme of ['light', 'soft']) {
        state.change({ admin: theme }); await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const last = choices.last(); await last.focus(); await last.press('Enter');
        await expect(last).toHaveClass(/admin-ai__video-model-card--active/);
        await expect(page.locator('#aiVideoPrompt')).toBeVisible();
        await page.locator('#aiVideoPrompt').fill('Do not submit this retained draft');
        const text = await require('./helpers/appearance').measureContrast(page.locator('.admin-ai__video-model-card-title,.admin-ai__video-model-card-id,.admin-ai__video-model-card-copy,#aiVideoModelBadge,#aiVideoPrompt'));
        expect(text.length).toBeGreaterThan(await choices.count());
        for (const value of text) expect(value.ratio, JSON.stringify(value)).toBeGreaterThanOrEqual(4.5);
        metrics.push({ theme, text });
        await page.screenshot({ path: info.outputPath(`admin-video-${theme}.png`), fullPage: true });
    }
    state.change({ admin: 'dark' }); await page.evaluate(() => window.BitbiAppearance.refresh({ force: true }));
    await expect(page.locator('#aiVideoPrompt')).toHaveValue('Do not submit this retained draft');
    expect(state.unexpectedWrites).toEqual([]); expect(state.errors).toEqual([]);
    await info.attach('rendered-contrast', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});
