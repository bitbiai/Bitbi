const { test, expect } = require('@playwright/test');
const { setupAppearance } = require('./helpers/appearance');
const root = page => page.locator('#sectionWebsiteAssistant');
const copy = value => structuredClone(value);

// Browser API fixtures are synthetic. The same stored configuration and overview
// functions are used here; actual authorization, atomic admission and runtime
// persistence are exercised separately at their Worker / Durable Object boundary.
async function setup(page, baseURL, { role = 'admin', adminGate = 0 } = {}) {
    const common = await setupAppearance(page, baseURL, { role, adminGate });
    const control = await import('../workers/auth/src/lib/website-assistant-control.js');
    const { ASSISTANT_POLICY } = await import('../workers/auth/src/lib/website-assistant-policy.js');
    const { harness } = await import('./helpers/website-assistant-fixture.mjs');
    const fixture = harness();
    const state = { ...common, assistantCalls: [], failure: 0, malformed: false, adjust: value => value, previous: null };
    const env = { ...fixture.env, WEBSITE_ASSISTANT_ENABLED: 'false', AI: { run() { throw Error('Browser fixture must never invoke a provider'); } } };
    async function snapshot() {
        const stored = await control.callAssistantControl(env);
        return state.adjust(control.assistantAdminOverview(env, ASSISTANT_POLICY, stored));
    }
    state.current = snapshot;
    state.advance = async settings => {
        const stored = await control.callAssistantControl(env);
        await control.callAssistantControl(env, 'write', { revision: stored.control.revision, settings: { ...stored.control.settings, ...settings }, actor: 'test-second-admin' });
    };
    await page.route('**/api/admin/website-assistant{,/**}', async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname, method = request.method();
        const body = request.postData() ? request.postDataJSON() : null;
        state.assistantCalls.push({ pathname, method, body });
        if (state.failure) return route.fulfill({ status: state.failure, json: { ok: false, error: 'Raw private provider details must not be rendered', code: 'test_failure' } });
        if (pathname.endsWith('/acceptance')) { state.unexpectedWrites.push(pathname); return route.fulfill({ status: 503, json: { ok: false, code: 'fixture_never_infers' } }); }
        if (state.malformed) return route.fulfill({ json: { ok: true, config: {} } });
        if (method === 'GET' && pathname === '/api/admin/website-assistant') return route.fulfill({ json: await snapshot() });
        if (method === 'POST' && pathname.endsWith('/check')) return route.fulfill({ json: { ...await snapshot(), check: { checkedAt: new Date().toISOString(), inferencePerformed: false } } });
        if (method === 'PUT' && pathname.endsWith('/config') || method === 'POST' && pathname.endsWith('/restore')) {
            const action = pathname.endsWith('/restore') ? 'restore' : 'write';
            const result = await control.callAssistantControl(env, action, { ...body, actor: 'test-admin' });
            return route.fulfill({ status: result.ok ? 200 : 409, json: result.ok ? await snapshot() : result });
        }
        state.unexpectedWrites.push(`${method} ${pathname}`); return route.fulfill({ status: 405, json: { ok: false } });
    });
    return state;
}
async function open(page) {
    await page.goto('/admin/index.html#website-assistant');
    await expect(root(page).getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}
function safe(state) {
    expect(state.errors).toEqual([]); expect(state.unexpectedWrites).toEqual([]);
    expect(state.assistantCalls.filter(call => call.pathname.endsWith('/acceptance'))).toEqual([]);
}

test('assistant Admin is lazy, reports off and unknown connection truthfully, previews EN/DE knowledge without inference', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL);
    await page.goto('/admin/index.html#appearance');
    await expect(page.locator('#sectionAppearance')).toBeVisible();
    expect(state.assistantCalls).toEqual([]);
    await page.locator('[data-section="website-assistant"]').click();
    await expect(root(page).getByRole('heading', { name: 'Public inference is off' })).toBeVisible();
    await expect(root(page).getByRole('radio', { name: 'Admin test', exact: true })).toBeDisabled();
    await expect(root(page).getByRole('radio', { name: 'Public', exact: true })).toBeDisabled();
    await expect(root(page).getByRole('button', { name: 'Run real-response test · may incur cost' })).toBeDisabled();
    await expect(root(page).locator('#assistant-connection')).toContainText('Unverified');
    await expect(root(page).locator('#assistant-connection')).toContainText('Present — not an entitlement check');
    await expect(root(page).locator('#assistant-usage')).toContainText('Inference rates are unknown');
    await expect(root(page).locator('#assistant-usage')).toContainText('Unknown — no measured sample');
    await root(page).getByLabel('Knowledge preview language').selectOption('de');
    await root(page).getByLabel('Suggestion page context').selectOption('canvas');
    await expect(root(page).locator('.assistant-admin__preview li')).toHaveCount(3);
    await expect(root(page).locator('.assistant-admin__preview')).toContainText('Wie starte ich einen Canvas-Workflow?');
    await root(page).getByText('Preview approved topics', { exact: true }).click();
    await expect(root(page).locator('.assistant-admin__topic')).toHaveCount(18);
    await root(page).locator('.assistant-admin__topic').filter({ hasText: 'Einen Canvas-Workflow starten' }).locator('summary').click();
    await expect(root(page).locator('.assistant-admin__topic[open] a')).toHaveAttribute('href', 'https://bitbi.ai/de/canvas/');
    const before = state.assistantCalls.length;
    await root(page).getByRole('button', { name: 'Check configuration · no inference' }).click();
    await expect(root(page).getByRole('status').filter({ hasText: 'Configuration checked at' })).toContainText('No inference was performed');
    expect(state.assistantCalls.length).toBe(before + 1);
    expect(state.assistantCalls.at(-1).pathname).toBe('/api/admin/website-assistant/check');
    safe(state);
});

test('assistant Admin allows ready Off to Admin intent without invoking a model and labels expired prices and sanitized errors', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL);
    await state.advance({ pages: ['canvas'], languages: ['de'] });
    state.adjust = value => {
        value.runtime.adminReady = true; value.runtime.adminTestReady = value.config.settings.mode === 'admin';
        value.runtime.effectiveMode = value.config.settings.mode === 'admin' ? 'admin' : 'off';
        value.connection.rates = { inputUsdMicrosPerMillion: 1000, outputUsdMicrosPerMillion: 2000, validUntil: '2000-01-01', verifiedAt: '1999-01-01' };
        value.connection.ratesStatus = 'expired';
        value.usage.lastError = { code: 'provider_error', at: '2026-09-30T12:00:00Z', evidence: 'synthetic' }; return value;
    };
    await open(page);
    await expect(root(page).getByRole('radio', { name: 'Admin test', exact: true })).toBeEnabled();
    await expect(root(page).getByRole('button', { name: 'Run real-response test · may incur cost' })).toBeDisabled();
    await expect(root(page).locator('#assistant-usage')).toContainText('Recorded inference prices have expired');
    await expect(root(page).locator('#assistant-diagnostics')).toContainText('provider_error');
    await expect(root(page).locator('#assistant-diagnostics')).toContainText('synthetic or unclassified evidence');
    await root(page).getByRole('radio', { name: 'Admin test', exact: true }).check();
    await root(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(root(page).getByRole('heading', { name: 'Admin testing only' })).toBeVisible();
    await expect(root(page).getByLabel('Real-response test language')).toHaveValue('de');
    await expect(root(page).getByLabel('Real-response test language').locator('option')).toHaveCount(1);
    await expect(root(page).getByRole('button', { name: 'Run real-response test · may incur cost' })).toBeEnabled();
    safe(state);
});

test('assistant Admin persists settings, preserves conflicting drafts and restores previous configuration with inference off', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL); page.on('dialog', dialog => dialog.accept());
    await open(page);
    await root(page).getByLabel('Answer tone').selectOption('friendly');
    await root(page).getByLabel('English greeting / help text').fill('Ask about BITBI and keep personal details private.');
    await root(page).getByLabel('Show three grounded contextual suggestions').uncheck();
    await expect(root(page).locator('.assistant-admin__saved')).toHaveText('Unsaved changes');
    await root(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(root(page).locator('.assistant-admin__saved')).toHaveText('Saved · revision 1');
    await page.reload();
    await expect(root(page).getByLabel('Answer tone')).toHaveValue('friendly');
    await expect(root(page).getByLabel('Show three grounded contextual suggestions')).not.toBeChecked();
    await root(page).getByRole('button', { name: 'Restore previous settings with inference off' }).click();
    await expect(root(page).locator('.assistant-admin__saved')).toHaveText('Saved · revision 2');
    await expect(root(page).getByLabel('Answer tone')).toHaveValue('concise');
    await expect(root(page).getByRole('radio', { name: 'Off', exact: true })).toBeChecked();
    await root(page).getByLabel('Answer tone').selectOption('neutral');
    await state.advance({ tone: 'friendly' });
    await root(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(root(page).getByRole('alert')).toContainText('Another administrator saved newer settings');
    await expect(root(page).getByLabel('Answer tone')).toHaveValue('neutral');
    await expect(root(page).getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await root(page).getByRole('button', { name: 'Refresh status' }).click();
    await expect(root(page).getByLabel('Answer tone')).toHaveValue('friendly');
    safe(state);
});

test('assistant Admin distinguishes a saved public mode from budget pause and deactivation discards an unsaved activation draft', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL);
    await state.advance({ mode: 'public' });
    state.adjust = value => {
        if (value.config.settings.mode !== 'off') value.runtime = { ...value.runtime, effectiveMode: 'budget_paused', publicReady: true, adminReady: true, adminTestReady: false,
            blockers: [{ code: 'budget_paused', message: 'The approved daily spending allowance is exhausted.' }] };
        value.usage.limits = { dailyUsdMicros: 1000000, monthlyUsdMicros: 10000000 };
        value.usage.daily.chargedMicros = 1000000; return value;
    };
    await open(page);
    await expect(root(page).getByRole('heading', { name: 'Paused by a usage or spending limit' })).toBeVisible();
    await expect(root(page).locator('.assistant-admin__state')).toContainText('Saved intent: Public');
    await expect(root(page).locator('#assistant-usage')).toContainText('US$1.00');
    await root(page).getByLabel('Answer tone').selectOption('friendly');
    await root(page).getByRole('button', { name: 'Turn inference off now' }).click();
    await expect(root(page).getByRole('heading', { name: 'Public inference is off' })).toBeVisible();
    expect((await state.current()).config.settings).toMatchObject({ mode: 'off', tone: 'concise' });
    safe(state);
});

for (const [role, gate] of [['anonymous', 0], ['user', 0], ['admin', 428]]) test(`assistant Admin requires existing ${role}/${gate} authorization before discovery`, async ({ page, baseURL }) => {
    const state = await setup(page, baseURL, { role, adminGate: gate });
    await page.goto('/admin/index.html#website-assistant');
    await expect(page.locator('#adminDenied')).toBeVisible();
    await expect(root(page)).toBeHidden(); expect(state.assistantCalls).toEqual([]); safe(state);
});

test('assistant Admin hides failed or malformed status and rejects unconfirmed save without exposing diagnostic details', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL); await open(page);
    await root(page).getByLabel('Answer tone').selectOption('friendly'); state.failure = 503;
    await root(page).getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(root(page).getByRole('alert')).toContainText('The change was not confirmed');
    await expect(root(page).getByLabel('Answer tone')).toHaveValue('friendly');
    await expect(root(page)).not.toContainText('Raw private provider details');
    await expect(root(page).getByRole('button', { name: 'Run real-response test · may incur cost' })).toBeDisabled();
    state.failure = 0; state.malformed = true; await page.reload();
    await expect(root(page).getByRole('alert')).toContainText('unavailable or invalid');
    await expect(root(page).locator('.assistant-admin__state')).toHaveCount(0);
    state.malformed = false; await root(page).getByRole('button', { name: 'Retry loading controls' }).click();
    await expect(root(page).getByRole('heading', { name: 'Public inference is off' })).toBeVisible(); safe(state);
});

test('assistant Admin synthetic evidence is never a genuine connection, safe text cannot inject markup or source URLs', async ({ page, baseURL }) => {
    const state = await setup(page, baseURL);
    state.adjust = value => {
        value.connection.lastSuccessfulInference = null; value.connection.syntheticEvidencePresent = true;
        value.knowledge.topics[0].en.text = '<img src=x onerror="window.testUnsafe=1">';
        value.knowledge.topics[0].en.url = 'javascript:window.testUnsafe=1'; return value;
    };
    await open(page);
    await expect(root(page).locator('#assistant-connection')).toContainText('Synthetic or unclassified evidence is not a live connection result');
    await expect(root(page).locator('#assistant-connection')).not.toContainText('synthetic fixture');
    await root(page).getByText('Preview approved topics', { exact: true }).click();
    await root(page).locator('.assistant-admin__topic').first().locator('summary').click();
    await expect(root(page).locator('.assistant-admin__topic').first()).toContainText('<img src=x');
    await expect(root(page).locator('.assistant-admin__topic').first().locator('a')).toHaveCount(0);
    expect(await page.evaluate(() => window.testUnsafe)).toBeUndefined(); safe(state);
});

for (const [width, theme] of [[390, 'dark'], [768, 'light'], [1440, 'soft']]) test(`assistant Admin ${width}px ${theme} supports keyboard, labelled controls and readable responsive layout`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 }); const state = await setup(page, baseURL); state.appearance.segments.admin = theme; await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const jump = root(page).getByRole('navigation', { name: 'Assistant controls' }).getByRole('button', { name: 'Settings', exact: true });
    await jump.focus(); await page.keyboard.press('Enter'); await expect(root(page).locator('#assistant-settings')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(root(page).getByLabel('Model', { exact: true })).toBeFocused();
    const missing = await root(page).locator('input,select,textarea').evaluateAll(nodes => nodes.filter(node => !node.labels?.length && !node.getAttribute('aria-label')).length); expect(missing).toBe(0);
    const greeting = root(page).getByLabel('English greeting / help text'); await greeting.fill('Useful BITBI help.');
    await expect(root(page).getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    for (const box of await root(page).locator('button:visible,select:visible,input:not([type=radio]):not([type=checkbox]):visible').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))) {
        expect(box.height).toBeGreaterThanOrEqual(43); expect(box.width).toBeGreaterThanOrEqual(43);
    }
    const measures = await require('./helpers/appearance').measureContrast(root(page).locator('.assistant-admin__intro,.assistant-admin__muted,.assistant-admin__field label,.assistant-admin__state h4'));
    for (const measurement of measures) expect(measurement.ratio).toBeGreaterThanOrEqual(4.5);
    if (width === 390 || width === 1440) {
        await root(page).locator('#assistant-overview').scrollIntoViewIfNeeded();
        await test.info().attach(`assistant-admin-${width}-${theme}`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    safe(state);
});
