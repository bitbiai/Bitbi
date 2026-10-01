const { test, expect } = require('@playwright/test');

const languages = [
    { locale: 'en', prefix: '', open: 'Open help menu', title: 'Ask BITBI', input: 'Your question about BITBI', send: 'Send', clear: 'Clear conversation', complete: 'Answer complete.' },
    { locale: 'de', prefix: '/de', open: 'Hilfemenü öffnen', title: 'BITBI fragen', input: 'Ihre Frage zu BITBI', send: 'Senden', clear: 'Gespräch löschen', complete: 'Antwort vollständig.' },
];

function configuration(locale, version = 'knowledge-test-v1') {
    return {
        enabled: true, contentVersion: version,
        suggestions: (locale === 'de' ? ['Wie funktionieren Credits?', 'Wo finde ich meine Ergebnisse?', 'Wie beginne ich in Canvas?'] : ['How do credits work?', 'Where can I find my results?', 'How do I start in Canvas?']).map((question, index) => ({ id: `question-${index}`, question })),
        limits: { inputChars: 2000, historyMessages: 6 },
    };
}

function stream(locale, text = 'Use the Credits page to check the current balance.', sources = null) {
    return [
        ['meta', { contentVersion: 'knowledge-test-v1', sources: sources || [{ id: 'credits', title: 'Credits', url: `${locale === 'de' ? '/de' : ''}/account/credits.html` }] }],
        ['delta', { text: text.slice(0, 12) }], ['delta', { text: text.slice(12) }], ['done', { usage: { inputTokens: 10, outputTokens: 12 } }],
    ].map(([event, value]) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`).join('');
}

async function fixtures(page, options = {}) {
    const requests = [], configs = [], unexpected = [];
    let currentConfig = options.config;
    await page.addInitScript(() => {
        localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false }));
    });
    await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/api/public/assistant/config') {
            configs.push({ page: url.searchParams.get('page'), locale: url.searchParams.get('locale'), url: request.url(), headers: request.headers() });
            return route.fulfill({ json: currentConfig === undefined ? configuration(url.searchParams.get('locale')) : currentConfig });
        }
        if (url.pathname === '/api/public/assistant/chat') {
            requests.push({ body: request.postDataJSON(), headers: request.headers() });
            if (options.chat) return options.chat(route);
            return route.fulfill({ contentType: 'text/event-stream', body: stream(request.postDataJSON().locale) });
        }
        if (!['GET', 'HEAD'].includes(request.method())) {
            unexpected.push({ method: request.method(), path: url.pathname });
            return route.fulfill({ status: 400, json: { ok: false } });
        }
        if (url.pathname === '/api/me') return route.fulfill({ json: { ok: true, loggedIn: false, user: null } });
        return route.fulfill({ json: { ok: true, items: [], images: [], videos: [], tracks: [] } });
    });
    return { requests, configs, unexpected, setConfig(value) { currentConfig = value; } };
}

for (const language of languages) {
    test(`website assistant ${language.locale}: actual Help entry, scoped requests, sources and keyboard recovery`, async ({ page }) => {
        const state = await fixtures(page);
        await page.goto(`${language.prefix}/pricing.html?privateDraft=never-send-this`);
        const trigger = page.getByRole('button', { name: language.open });
        await trigger.press('Enter');
        await expect(page.getByRole('heading', { name: language.title, exact: true })).toBeVisible();
        await expect(page.locator('#bitbiHelpTitle')).toBeFocused();
        await expect(page.locator('.website-assistant__suggestion')).toHaveCount(3);
        expect(state.requests).toHaveLength(0);
        await page.evaluate(() => {
            const privateValue = document.createElement('input');
            privateValue.value = 'private-account-balance-123';
            document.body.append(privateValue);
            document.cookie = 'private_session=not-forwarded; path=/';
        });
        await page.locator('.website-assistant__suggestion').first().click();
        const input = page.getByLabel(language.input);
        await expect(input).toBeFocused();
        await input.press('Enter');
        await expect(page.locator('#websiteAssistantStatus')).toHaveText(language.complete);
        await expect(page.locator('.website-assistant__suggestions')).toBeHidden();
        await expect(page.locator('.website-assistant__sources a')).toHaveAttribute('href', `${language.prefix}/account/credits.html`);
        expect(state.requests).toHaveLength(1);
        expect(Object.keys(state.requests[0].body).sort()).toEqual(['contentVersion', 'history', 'locale', 'message', 'page']);
        expect(state.requests[0].body.page).toBe('pricing');
        expect(state.requests[0].body.locale).toBe(language.locale);
        expect(state.requests[0].body.history).toEqual([]);
        expect(JSON.stringify(state.requests)).not.toContain('never-send-this');
        expect(JSON.stringify(state.requests)).not.toContain('private-account-balance');
        expect(state.requests[0].headers.cookie).toBeUndefined();
        expect(state.requests[0].headers.referer).toBeUndefined();
        await input.press('Escape');
        await expect(page.locator('#bitbiHelpPanel')).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.press('Enter');
        await page.getByRole('button', { name: language.clear, exact: true }).click();
        await expect(page.locator('.website-assistant__message')).toHaveCount(0);
        await expect(page.locator('.website-assistant__suggestions')).toBeVisible();
        await expect(input).toBeFocused();
        expect(state.unexpected).toEqual([]);
    });
}

test('website assistant: disabled and malformed activation preserve existing help without chat', async ({ page }) => {
    const state = await fixtures(page, { config: { enabled: false } });
    await page.goto('/pricing.html');
    await page.getByRole('button', { name: 'Open help menu' }).click();
    await expect.poll(() => state.configs.length).toBe(1);
    await expect(page.locator('[data-website-assistant]')).toBeHidden();
    await expect(page.locator('[data-help-section="credits"]')).toBeVisible();
    await page.keyboard.press('Escape');
    // Stop the existing Help trigger's hover animation before another pointer click.
    await page.mouse.move(0, 0);
    state.setConfig({ ...configuration('en'), suggestions: [{ id: 'broken', question: 'Unsupported' }] });
    await page.getByRole('button', { name: 'Open help menu' }).click();
    await expect.poll(() => state.configs.length).toBe(2);
    await expect(page.locator('[data-website-assistant]')).toBeHidden();
    expect(state.requests).toEqual([]);
});

test('website assistant: saved greeting and suggestion changes refresh without inference or stale cache', async ({ page }) => {
    const state = await fixtures(page, { config: { ...configuration('en'), configRevision: 1, greeting: 'Welcome to BITBI help.' } });
    await page.goto('/pricing.html');
    const trigger = page.getByRole('button', { name: 'Open help menu' });
    await trigger.press('Enter');
    await expect(page.locator('.website-assistant__greeting')).toHaveText('Welcome to BITBI help.');
    await expect(page.locator('.website-assistant__suggestion')).toHaveCount(3);
    await page.keyboard.press('Escape');
    state.setConfig({ ...configuration('en'), configRevision: 2, greeting: 'Updated public help.', suggestions: [] });
    await trigger.press('Enter');
    await expect(page.locator('.website-assistant__greeting')).toHaveText('Updated public help.');
    await expect(page.locator('.website-assistant__suggestions')).toBeHidden();
    await expect(page.getByLabel('Your question about BITBI')).toBeVisible();
    await page.keyboard.press('Escape');
    state.setConfig({ ...configuration('en'), configRevision: 3, greeting: 'Welcome again.' });
    await trigger.press('Enter');
    await expect(page.locator('.website-assistant__suggestion')).toHaveCount(3);
    expect(state.requests).toEqual([]);
    expect(state.unexpected).toEqual([]);
});

test('website assistant: reply is text; unsafe, foreign and private source URLs are rejected', async ({ page }) => {
    const attack = '<img src=x onerror="window.assistantInjected=true">';
    const state = await fixtures(page, { chat: route => route.fulfill({ contentType: 'text/event-stream', body: stream('en', attack, [
        { title: 'Safe Credits', url: 'https://bitbi.ai/account/credits.html' },
        { title: 'Script', url: 'javascript:alert(1)' }, { title: 'Foreign', url: 'https://example.com/' },
        { title: 'Admin', url: '/admin/' }, { title: 'API', url: '/api/me' },
        { title: 'Private', url: '/account/profile.html?session=private' },
    ]) }) });
    await page.goto('/pricing.html');
    await page.getByRole('button', { name: 'Open help menu' }).click();
    await page.getByLabel('Your question about BITBI').fill('How do credits work?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#websiteAssistantStatus')).toHaveText('Answer complete.');
    await expect(page.locator('.website-assistant__message--assistant .website-assistant__copy')).toHaveText(attack);
    await expect(page.locator('.website-assistant img')).toHaveCount(0);
    await expect(page.locator('.website-assistant__sources a')).toHaveCount(1);
    expect(await page.evaluate(() => window.assistantInjected)).toBeUndefined();
    expect(state.unexpected).toEqual([]);
});

test('website assistant: 429 preserves draft, respects Retry-After and never retries itself', async ({ page }) => {
    const state = await fixtures(page, { chat: route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { code: 'rate_limited' } }) });
    await page.goto('/pricing.html');
    await page.getByRole('button', { name: 'Open help menu' }).click();
    const input = page.getByLabel('Your question about BITBI');
    await input.fill('Where is my result?');
    await input.press('Enter');
    await expect(page.locator('#websiteAssistantStatus')).toContainText('Too many requests');
    await expect(input).toHaveValue('Where is my result?');
    await input.press('Enter');
    expect(state.requests).toHaveLength(1);
    await expect(page.locator('.website-assistant__message--assistant')).toHaveCount(0);
});

test('website assistant: incremental output, cancel, close and account changes isolate conversation', async ({ page }) => {
    await fixtures(page);
    await page.addInitScript(() => {
        const original = window.fetch;
        window.fetch = async (url, options) => {
            if (String(url).endsWith('/api/public/assistant/chat')) {
                window.assistantStreamCalls = (window.assistantStreamCalls || 0) + 1;
                const encoder = new TextEncoder();
                const body = new ReadableStream({ start(controller) {
                    controller.enqueue(encoder.encode('event: meta\ndata: {"contentVersion":"knowledge-test-v1","sources":[]}\n\nevent: delta\ndata: {"text":"Partial answer"}\n\n'));
                    options.signal.addEventListener('abort', () => {
                        window.assistantCancelled = (window.assistantCancelled || 0) + 1;
                        controller.error(new DOMException('Aborted', 'AbortError'));
                    });
                } });
                return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
            }
            return original(url, options);
        };
    });
    await page.goto('/pricing.html');
    await page.getByRole('button', { name: 'Open help menu' }).click();
    const input = page.getByLabel('Your question about BITBI');
    await input.fill('How do I start?');
    await input.press('Enter');
    await expect(page.locator('.website-assistant__copy').last()).toHaveText('Partial answer');
    await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop response' }).click();
    await expect(input).toHaveValue('How do I start?');
    await expect(input).toBeFocused();
    expect(await page.evaluate(() => window.assistantCancelled)).toBe(1);
    await input.press('Enter');
    await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.assistantCancelled)).toBe(2);
    await page.getByRole('button', { name: 'Open help menu' }).click();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('bitbi:auth-change')));
    await expect(input).toHaveValue('');
    await expect(page.locator('.website-assistant__message')).toHaveCount(0);
    expect(await page.evaluate(() => window.assistantStreamCalls)).toBe(2);
});

test('website assistant: mobile EN/DE context and content-version refresh clear previous answers', async ({ page }) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/de/pricing.html');
    const trigger = page.getByRole('button', { name: 'Hilfemenü öffnen' });
    await trigger.click();
    const input = page.getByLabel('Ihre Frage zu BITBI');
    await input.fill('Wie funktionieren Credits?');
    await input.press('Enter');
    await expect(page.locator('#websiteAssistantStatus')).toHaveText('Antwort vollständig.');
    const panel = await page.locator('#bitbiHelpPanel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    // Stop the existing Help trigger's hover animation before another pointer click.
    await page.mouse.move(0, 0);
    state.setConfig(configuration('de', 'knowledge-test-v2'));
    await trigger.click();
    await expect(page.locator('.website-assistant__message')).toHaveCount(0);
    await expect(page.locator('#websiteAssistantStatus')).toContainText('Hilfeinhalt');
    state.setConfig(configuration('en', 'knowledge-test-v2'));
    await page.evaluate(() => { history.pushState({}, '', '/canvas/'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.getByRole('heading', { name: 'Ask BITBI', exact: true })).toBeVisible();
    await expect.poll(() => state.configs.at(-1)?.page).toBe('canvas');
    expect(state.configs.at(-1).locale).toBe('en');
    expect(state.requests).toHaveLength(1);
});


test('website assistant: truncated provider stream remains an error and is excluded from follow-up history', async ({ page }) => {
    const state = await fixtures(page, { chat: route => route.fulfill({ contentType: 'text/event-stream', body:
        'event: meta\ndata: {"contentVersion":"knowledge-test-v1","sources":[]}\n\nevent: delta\ndata: {"text":"Incomplete output"}\n\n',
    }) });
    await page.goto('/pricing.html');
    await page.getByRole('button', { name: 'Open help menu' }).press('Enter');
    const input = page.getByLabel('Your question about BITBI');
    await input.fill('How do credits work?');
    await input.press('Enter');
    await expect(page.locator('#websiteAssistantStatus')).toContainText('could not be completed');
    await expect(input).toHaveValue('How do credits work?');
    await input.press('Enter');
    await expect.poll(() => state.requests.length).toBe(2);
    expect(state.requests[1].body.history).toEqual([]);
});

test('website assistant: existing legal soft navigation refreshes context while Help remains open', async ({ page }) => {
    const state = await fixtures(page, { chat: route => route.fulfill({ contentType: 'text/event-stream', body: stream('en', 'Review the BITBI Terms.', [{ title: 'BITBI Terms', url: '/legal/terms.html' }]) }) });
    // Exercise the existing canonical .html soft-navigation path. The generic
    // local static handler otherwise redirects this URL before soft-nav starts.
    for (const file of ['privacy', 'terms']) {
        await page.route(`**/legal/${file}.html`, route => route.fulfill({
            path: require('path').join(__dirname, '..', 'legal', `${file}.html`), contentType: 'text/html',
        }));
    }
    await page.goto('/legal/privacy.html');
    await page.getByRole('button', { name: 'Open help menu' }).press('Enter');
    const input = page.getByLabel('Your question about BITBI');
    await input.fill('Where are the terms?');
    await input.press('Enter');
    await expect(page.locator('#websiteAssistantStatus')).toHaveText('Answer complete.');
    await page.locator('.website-assistant__sources a').click();
    await expect(page).toHaveURL(/\/legal\/terms\.html$/);
    await expect(page.locator('#bitbiHelpPanel')).toBeVisible();
    await expect.poll(() => state.configs.at(-1)?.page).toBe('legal');
    await expect(page.locator('.website-assistant__message')).toHaveCount(0);
    expect(state.requests).toHaveLength(1);
});


for (const language of languages) {
    test(`website assistant ${language.locale}: real HTTP UI, route, knowledge and budget boundary with synthetic AI`, async ({ page, request }, testInfo) => {
        const id = require('crypto').randomUUID();
        const headers = { 'x-bitbi-assistant-fixture': 'test-only', 'x-bitbi-assistant-fixture-id': id };
        const unexpectedMutations = [];
        await page.route('**/api/**', route => {
            if (['GET', 'HEAD'].includes(route.request().method())) return route.fallback();
            unexpectedMutations.push(new URL(route.request().url()).pathname);
            return route.fulfill({ status: 400, json: { code: 'unexpected_test_mutation' } });
        });
        await page.setViewportSize(language.locale === 'de' ? { width: 390, height: 844 } : { width: 1280, height: 900 });
        // Only these loopback test-server requests opt into synthetic admission.
        // The browser still uses its actual same-origin fetch and streaming code.
        await page.route('**/api/public/assistant/**', route => route.continue({ headers: { ...route.request().headers(), ...headers } }));
        await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
        await page.goto(`${language.prefix}/pricing.html`);
        await page.getByRole('button', { name: language.open }).press('Enter');
        await expect(page.locator('.website-assistant__suggestion')).toHaveCount(3);
        const input = page.getByLabel(language.input);
        await input.fill(language.locale === 'de' ? 'Wie prüfe ich Credits vor dem Generieren?' : 'How do I check credits before generation?');
        await input.press('Enter');
        await expect(page.locator('#websiteAssistantStatus')).toHaveText(language.complete);
        await expect(page.locator('.website-assistant__message--assistant')).toContainText(language.locale === 'de' ? 'aktuelle Schätzung' : 'current estimate');
        await expect(page.locator('.website-assistant__sources a').first()).toHaveAttribute('href', /^\/(?:de\/)?(?:pricing|account|generate-lab)/);
        const metrics = await request.get('/__test/assistant-metrics', { headers });
        expect(metrics.ok()).toBe(true);
        expect(await metrics.json()).toEqual({ providerCalls: 1, measuredRequests: 1 });
        expect(unexpectedMutations).toEqual([]);
        const screenshot = testInfo.outputPath(`assistant-${language.locale}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`assistant-${language.locale}`, { path: screenshot, contentType: 'image/png' });
    });
}
