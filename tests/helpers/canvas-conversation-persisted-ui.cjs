const { responseBytes } = require('./canvas-agent-ui.cjs');

module.exports = async ({ page, expect, locale, info, mockSharedAuth, createCanvasApiMock }) => {
    const { SqliteD1Database, applyAuthMigrations } = require('./sqlite-d1.js');
    const { createAuthTestEnv } = require('./auth-worker-harness.js');
    const { canvasAgentConversationFixture } = await import('./canvas-agent-conversation-control.mjs');
    const DB = new SqliteD1Database(); applyAuthMigrations(DB);
    const errors = [], requests = [], de = locale === 'de';
    try {
        const c = await canvasAgentConversationFixture({ ...createAuthTestEnv(), DB }, { scope: 'conversation-browser-' + locale, locale });
        const f = c.f;
        await page.setViewportSize({ width: de ? 390 : 1440, height: 1000 });
        await mockSharedAuth(page); createCanvasApiMock(page); page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/account/canvas/**', async route => {
            const req = route.request(), url = new URL(req.url()), body = req.postData() ? req.postDataJSON() : undefined;
            const headers = {};
            for (const name of ['Idempotency-Key', 'X-Bitbi-Tariff-Revision']) if (req.headers()[name.toLowerCase()]) headers[name] = req.headers()[name.toLowerCase()];
            requests.push({ path: url.pathname, method: req.method(), body });
            const response = await f.request(url.pathname + url.search, req.method(), body, headers), bytes = await responseBytes(response);
            if (!page.isClosed()) await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: bytes });
        });
        const open = async () => { await page.goto(de ? '/de/canvas/' : '/canvas/'); await page.locator('#canvasAgentToggle').click(); };
        await open();
        const panel = page.locator('#canvasAgentPanel'), composer = panel.locator('.canvas-agent__composer');
        const input = composer.locator('textarea'), transcript = panel.locator('.canvas-agent__messages'), brief = panel.locator('.canvas-agent__brief');
        const submitMessage = async (text, pending = true) => {
            await expect(input).toBeEnabled(); await input.fill(text);
            const accepted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/conversation/messages') && response.request().method() === 'POST');
            await composer.locator('button[type=submit]').click();
            const response = await accepted, body = await response.json();
            expect(response.status(), JSON.stringify(body)).toBe(202);
            if (pending) expect(body.data.conversation.pendingTurnId).toBeTruthy();
            else expect(body.data.conversation.pendingTurnId).toBe(null);
            await expect(transcript).toContainText(text);
        };
        const allowance = panel.locator('.canvas-agent__allowance');
        await expect(allowance.locator('[name=briefingBudget]')).not.toHaveValue('');
        await allowance.locator('[name=briefingBudget]').fill('500');
        await allowance.getByRole('button', { name: de ? 'Dieses Gesprächsbudget freigeben' : 'Authorize this briefing allowance', exact: true }).click();
        await expect(allowance).toBeHidden();
        const initial = de ? 'Ein freundlicher Comicfilm über Hausbau, einen Pool mit Enten und ankommende Gäste.' : 'A friendly comic film about building a house, a duck pool and arriving visitors.';
        await submitMessage(initial);
        await expect(input).toBeDisabled();
        expect(c.calls).toHaveLength(0);
        const firstRevision = (await f.data(await f.request(f.projectPath))).project.revision;
        // Closing the UI has no role in queue dispatch or completion. Two queue
        // deliveries and duplicate signed callbacks still represent one turn.
        await page.locator('#canvasAgentToggle').click();
        await c.deliver(); expect(c.calls).toHaveLength(1);
        await c.complete({ text: de ? 'Ein freundlicher Comicfilm passt dazu.' : 'A friendly comic style fits that story.', fields: { story: initial, style: 'comic' } });
        await c.deliver();
        await page.reload(); await page.locator('#canvasAgentToggle').click();
        await expect(brief).toContainText(initial);
        await expect(transcript).toContainText(de ? 'Wie lang' : 'how long');
        expect((await f.data(await f.request(f.projectPath))).project.revision).toBe(firstRevision);
        const form = panel.locator('.canvas-agent__production-approval');
        await expect(form.locator('button[type=submit]')).toBeDisabled();
        expect(requests.filter(item => item.path.endsWith('/conversation/start'))).toEqual([]);
        await submitMessage(de ? 'Ungefähr zwei Minuten.' : 'About two minutes.');
        await expect(input).toBeDisabled(); await c.deliver();
        await c.complete({ text: de ? 'Die Zieldauer ist ungefähr zwei Minuten.' : 'The target duration is about two minutes.' }); await c.deliver();
        await page.reload(); await page.locator('#canvasAgentToggle').click();
        await expect(brief).toContainText('120 s');
        expect((await c.read()).messages.filter(message => message.role === 'assistant' && /how long|Wie lang/.test(message.text))).toHaveLength(1);
        expect(c.calls).toHaveLength(2);
        await form.locator('[name=budget]').fill('5000'); await form.locator('[name=authorize]').check();
        const admitted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/conversation/start') && response.request().method() === 'POST');
        await form.locator('button[type=submit]').click();
        expect((await admitted).status()).toBe(202);
        const production = requests.filter(item => item.path.endsWith('/conversation/start'));
        expect(production).toHaveLength(1); expect(production[0].body.authorized).toBe(true);
        const currentRun = (await f.data(await f.request(f.route))).run;
        expect(currentRun.status).toBe('queued');
        await submitMessage(de ? 'Wie weit bist du?' : 'How far along are you?', false);
        await expect(transcript).toContainText(de ? 'In der Warteschlange' : 'Queued');
        expect((await f.data(await f.request(f.route))).run.status).toBe('queued');
        expect((await f.data(await f.request(f.projectPath))).project.revision).toBe(firstRevision);
        expect(c.calls).toHaveLength(2);
        expect(requests.filter(item => item.path.endsWith('/control') && item.body?.action === 'pause')).toEqual([]);
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await info.attach('persisted-conversation', { contentType: 'application/json', body: JSON.stringify({ syntheticInference: true, acceptedTurns: c.calls.length, source: 'authenticated routes + signed background callback + D1', duration: 120, productionAuthorized: true, statusQuestionDidNotPause: true }) });
    } finally { if (!page.isClosed()) await page.close(); DB.close(); }
};
