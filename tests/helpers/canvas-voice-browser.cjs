function registerCanvasVoiceTests(test, expect, { mockSharedAuth, createCanvasApiMock } = {}) {
    async function harness(page, german, { available = false, admission = null, quotation = null, termination = null } = {}) {
        const calls = [];
        await page.route('**/voice-ui-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${german ? 'de' : 'en'}"><head><link rel="stylesheet" href="/css/base/tokens.css"><link rel="stylesheet" href="/css/base/reset.css"><link rel="stylesheet" href="/css/base/base.css"><link rel="stylesheet" href="/css/components/components.css"><link rel="stylesheet" href="/css/pages/canvas.css"><link rel="stylesheet" href="/css/pages/canvas-voice.css"></head><body style="background:#101217;color:white"><main id="voiceRoot" style="max-width:620px;margin:auto"></main><button id="outside">Outside</button></body></html>` }));
        await page.route('**/api/account/canvas/projects/**/agent/voice**', async route => {
            const request = route.request(), pathname = new URL(request.url()).pathname; calls.push({ pathname, method: request.method(), body: request.postDataJSON() });
            let data;
            if (pathname.endsWith('/sessions') && admission) { const result = await admission(request.postDataJSON()); await route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.body) }); return; }
            if (pathname.endsWith('/quote')) {
                const input = request.postDataJSON(), settings = await page.evaluate(() => window.voiceConfig.settings), manual = settings.turn_detection.type === null;
                data = { quote: { id: 'c'.repeat(32), capCredits: Math.ceil(input.maxDurationSeconds * (manual ? 2 : 1) / 10) * 2, maxDurationSeconds: input.maxDurationSeconds, maxBillableSeconds: input.maxDurationSeconds * (manual ? 2 : 1), expiresAt: new Date(Date.now() + 60000).toISOString(), settingsRevision: input.settingsRevision, creditsPerBlock: 2, unitSeconds: 10, billingMode: manual ? 'audio_in_plus_out' : 'session_elapsed', remainingConversationCredits: 5000, resumption: { enabled: settings.resumption.enabled, resuming: false, expiresAt: null } } };
                if (quotation) data.quote = quotation(data.quote);
            }
            else if (pathname.endsWith('/sessions')) { const input = request.postDataJSON(); data = { session: { id: input.requestId, settings: await page.evaluate(() => window.voiceConfig.settings), socketPath: `${pathname}/${input.requestId}/socket` } }; }
            else if (pathname.endsWith('/stop')) data = termination || { stopped: true };
            else if (pathname.endsWith('/settings')) data = await page.evaluate(input => { window.voiceConfig.settings = input.settings; window.voiceConfig.revision++; return window.voiceConfig; }, request.postDataJSON());
            else data = await page.evaluate(() => window.voiceConfig);
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
        });
        await page.goto('/voice-ui-harness');
        await page.evaluate(async ({ german, available }) => {
            const { canvasVoiceSettings } = await import('/js/shared/canvas-voice-settings.mjs');
            window.voiceConfig = { settings: canvasVoiceSettings(), revision: 1, availability: { available, code: available ? null : 'canvas_voice_disabled', maxDurationSeconds: 7200 }, capabilities: { voiceIds: ['eve', 'ara'], inputCodecs: ['audio/pcm', 'audio/pcmu', 'audio/pcma', 'audio/opus'], outputCodecs: ['audio/pcm', 'audio/pcmu', 'audio/pcma', 'audio/opus'], tools: ['canvas'], resumption: false } };
            window.voiceChanged = 0; window.micCalls = 0;
            const { createCanvasVoice } = await import('/js/pages/canvas/voice.js');
            window.voiceView = createCanvasVoice({ root: document.querySelector('#voiceRoot'), german, onChanged: () => window.voiceChanged++, getSnapshot: () => ({ revision: 7, briefRevision: 3, projectRevision: 11 }) });
            window.voiceView.projectChanged('1'.repeat(32)); window.voiceView.setVisible(true);
        }, { german, available });
        return calls;
    }
    for (const german of [false, true]) test(`Canvas Voice settings ${german ? 'DE' : 'EN'} are complete, persistent, keyboard accessible and do not start recording`, async ({ page }, info) => {
        await page.setViewportSize({ width: 390, height: 740 }); const calls = await harness(page, german);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
        await expect(dialog.locator('[data-voice-setting]')).toHaveCount(46);
        await expect(dialog.locator('[data-voice-setting="voice"]').locator('..')).toContainText(german ? 'USA außer Illinois' : 'US except Illinois');
        await dialog.locator('[data-voice-setting="preferences.language"]').selectOption('de');
        await dialog.locator('[data-voice-setting="audio.output.speed"]').fill('1.2');
        await dialog.locator('summary').filter({ hasText: german ? /^Gesprächsverhalten$/ : /^Conversation$/ }).click();
        await dialog.locator('[data-voice-setting="preferences.tone"]').fill('calm');
        await dialog.locator('summary').filter({ hasText: german ? /^Audio und Erweitert$/ : /^Audio and advanced$/ }).click();
        await expect(dialog.locator('[data-voice-setting="response.modalities"]').locator('..')).toContainText(german ? 'nicht für automatisch erkannte Sprecherwechsel' : 'not to automatic turn detection');
        await dialog.locator('[data-voice-setting="audio.input.format.type"]').selectOption('audio/pcmu');
        await expect(dialog.locator('[data-voice-setting="audio.input.format.rate"]')).toHaveValue('8000');
        await dialog.locator('[data-voice-setting="audio.input.transport"]').selectOption('binary');
        await dialog.locator('summary').filter({ hasText: german ? /^Werkzeuge$/ : /^Tools$/ }).click();
        await dialog.locator('[data-voice-setting="tools.canvas.enabled"]').check();
        await expect(dialog.locator('[data-voice-setting="tools.web_search.enabled"]')).toBeDisabled();
        await dialog.getByRole('button', { name: german ? 'Einstellungen übernehmen' : 'Save settings', exact: true }).click();
        await expect(dialog.locator('p[role=status]')).toContainText(german ? 'Gespeichert' : 'Saved');
        expect(calls.filter(call => call.method === 'POST').map(call => call.pathname.endsWith('/settings'))).toEqual([true]);
        expect(calls.at(-1).body.settings.preferences).toMatchObject({ language: 'de', tone: 'calm' });
        expect(calls.at(-1).body.settings.audio.input).toMatchObject({ format: { type: 'audio/pcmu', rate: 8000 }, transport: 'binary' });
        expect(calls.at(-1).body.settings.audio.output.speed).toBe(1.2); expect(calls.at(-1).body.settings.tools.canvas.enabled).toBe(true);
        await dialog.screenshot({ path: info.outputPath(`voice-settings-${german ? 'de' : 'en'}.png`) });
        await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
        await page.getByRole('button', { name: 'Settings', exact: true }).click(); await expect(dialog.locator('[data-voice-setting="preferences.language"]')).toHaveValue('de');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.keyboard.press('Escape'); await page.locator('[data-canvas-voice="toggle"]').click();
        await expect(page.locator('.canvas-voice__status')).toContainText(german ? 'nicht aktiviert' : 'not currently enabled');
        expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false);
    });
    for (const german of [false, true]) for (const manual of [false, true]) test(`Canvas Voice cost approval ${german ? 'DE' : 'EN'} ${manual ? 'manual audio' : 'VAD elapsed'} uses only the server quote and allowance`, async ({ page }, info) => {
        await page.setViewportSize({ width: german ? 390 : 1280, height: 740 });
        const calls = await harness(page, german, { available: true });
        if (manual) await page.evaluate(() => { window.voiceConfig.settings.turn_detection.type = null; window.voiceConfig.settings.turn_detection.idle_timeout_ms = null; });
        await page.locator('[data-canvas-voice="toggle"]').click(); const dialog = page.getByRole('dialog'), duration = dialog.getByRole('spinbutton');
        await expect(duration).toHaveAttribute('max', '7200'); await expect(duration).toHaveValue('300');
        await expect(dialog.getByRole('status')).toContainText(german ? 'freigegebenen Gesprächslimit' : 'approved conversation allowance');
        const authorize = dialog.getByRole('checkbox'), start = dialog.getByRole('button', { name: german ? 'Mikrofon freigeben und starten' : 'Allow microphone and start', exact: true });
        await expect(authorize).not.toBeChecked(); await expect(start).toBeDisabled(); await authorize.check(); await expect(start).toBeEnabled();
        await duration.fill('600'); await expect(authorize).not.toBeChecked(); await expect(start).toBeDisabled();
        await dialog.getByRole('button', { name: german ? 'Kosten prüfen' : 'Review cost', exact: true }).click();
        await expect(dialog.getByRole('status')).toContainText(`${manual ? 240 : 120} ${german ? 'Credits' : 'credits'}`);
        await expect(dialog.getByRole('status')).toContainText(german ? '2 Credits je angefangene 10 Sekunden' : '2 credits per started 10 seconds');
        await expect(dialog.getByRole('status')).toContainText(german ? '5000 Credits verfügbar' : '5000 credits available');
        await expect(dialog.getByRole('status')).toContainText(manual ? (german ? '1200 Audiosekunden bei 600 Sekunden' : '1200 audio seconds within 600 seconds') : (german ? 'gesamte Gesprächsdauer, auch Pausen' : 'entire conversation duration counts, including pauses'));
        await expect(dialog.getByRole('status')).toContainText(german ? 'einmalig zum Sitzungsende' : 'charged once at session end');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await dialog.screenshot({ path: info.outputPath(`voice-cost-${german ? 'de' : 'en'}-${manual ? 'manual' : 'vad'}.png`) });
        const quotes = calls.filter(call => call.pathname.endsWith('/quote')); expect(quotes.map(call => call.body.maxDurationSeconds)).toEqual([300, 600]);
        await duration.fill('7201'); await dialog.getByRole('button', { name: german ? 'Kosten prüfen' : 'Review cost', exact: true }).click();
        await expect(dialog.getByRole('status')).toContainText(german ? 'Dauer und aktuellen Projektstand' : 'duration and current project state');
        expect(calls.filter(call => call.pathname.endsWith('/quote'))).toHaveLength(2); expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false); expect(await page.evaluate(() => window.micCalls)).toBe(0);
    });
    for (const german of [false, true]) test(`Canvas Voice resumption ${german ? 'DE' : 'EN'} discloses provider retention and requires fresh approval`, async ({ page }) => {
        const expiry = new Date(Date.now() + 10 * 60000).toISOString();
        const calls = await harness(page, german, { available: true, quotation: value => ({ ...value, resumption: { enabled: true, resuming: true, expiresAt: expiry } }) });
        await page.evaluate(() => { window.voiceConfig.capabilities.resumption = true; });
        await page.getByRole('button', { name: 'Settings', exact: true }).click(); const settings = page.getByRole('dialog');
        await settings.locator('summary').filter({ hasText: german ? /^Gesprächsverhalten$/ : /^Conversation$/ }).click();
        const option = settings.locator('[data-voice-setting="resumption.enabled"]'); await expect(option).not.toBeChecked();
        await expect(option.locator('..')).toContainText(german ? '30 Minuten nach Inaktivität' : '30 minutes of inactivity');
        await option.check(); await settings.getByRole('button', { name: german ? 'Einstellungen übernehmen' : 'Save settings', exact: true }).click();
        await expect(settings.locator('p[role=status]')).toContainText(german ? 'Gespeichert' : 'Saved'); await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Settings', exact: true }).click(); await expect(option).toBeChecked(); await page.keyboard.press('Escape');
        await page.locator('[data-canvas-voice="toggle"]').click(); const approval = page.getByRole('dialog');
        await expect(approval).toContainText(german ? 'Der vorherige Kontext wird fortgesetzt' : 'The previous context will resume');
        await expect(approval).toContainText(german ? '30 Minuten nach Inaktivität' : '30 minutes of inactivity');
        await expect(approval).toContainText(german ? 'Keine automatische Wiederverbindung' : 'No automatic reconnection');
        await expect(approval.getByRole('checkbox')).not.toBeChecked(); await expect(approval.getByRole('button', { name: german ? 'Mikrofon freigeben und starten' : 'Allow microphone and start', exact: true })).toBeDisabled();
        expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false); expect(await page.evaluate(() => window.micCalls)).toBe(0);
        expect(calls.find(call => call.pathname.endsWith('/settings')).body.settings.resumption).toEqual({ enabled: true });
    });
    test('Canvas Voice expired resumption and unsolicited resume cannot enable microphone', async ({ page }) => {
        const calls = await harness(page, false, { available: true, quotation: value => ({ ...value, resumption: { enabled: true, resuming: true, expiresAt: new Date(Date.now() - 1000).toISOString() } }) });
        for (const enabled of [false, true]) {
            await page.evaluate(value => { window.voiceConfig.capabilities.resumption = true; window.voiceConfig.settings.resumption.enabled = value; }, enabled);
            await page.locator('[data-canvas-voice="toggle"]').click(); const dialog = page.getByRole('dialog');
            await expect(dialog.getByRole('status')).toHaveText('No confirmed cost authorization is available.');
            await dialog.getByRole('checkbox').check(); await expect(dialog.getByRole('button', { name: 'Allow microphone and start', exact: true })).toBeDisabled(); await page.keyboard.press('Escape');
        }
        expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false); expect(await page.evaluate(() => window.micCalls)).toBe(0);
    });
    test('Canvas Voice malformed cost quote never enables admission or microphone', async ({ page }) => {
        const calls = await harness(page, false, { available: true, quotation: value => ({ ...value, creditsPerBlock: null }) });
        await page.locator('[data-canvas-voice="toggle"]').click(); const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('status')).toHaveText('No confirmed cost authorization is available.');
        await dialog.getByRole('checkbox').check(); await expect(dialog.getByRole('button', { name: 'Allow microphone and start', exact: true })).toBeDisabled();
        expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false); expect(await page.evaluate(() => window.micCalls)).toBe(0);
    });
    for (const locale of ['en', 'de']) test(`Canvas Voice actual Canvas ${locale} stops recording on unconfirmed auth without losing the text draft`, async ({ page }, info) => {
        let channel, closeCount = 0; const frames = [], calls = [];
        await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/, socket => { channel = socket; socket.onMessage(data => frames.push(JSON.parse(data))); socket.onClose(() => closeCount++); socket.send(JSON.stringify({ type: 'voice.state', state: 'listening' })); });
        const { canvasVoiceSettings } = await import('../../js/shared/canvas-voice-settings.mjs');
        const settings = canvasVoiceSettings(), config = { settings, revision: 1, capabilities: { voiceIds: ['eve'], inputCodecs: ['audio/pcm'], outputCodecs: ['audio/pcm'], tools: ['canvas'], resumption: false }, availability: { available: true, maxDurationSeconds: 7200 } };
        const { state, canvas, panel, composer } = await require('./canvas-agent-ui.cjs').fixture({ page, locale, mockSharedAuth, createCanvasApiMock });
        const size = locale === 'de' ? { width: 430, height: 560 } : { width: 1280, height: 600 };
        await page.setViewportSize(size);
        state.conversation.allowance = { capCredits: 5000, committedCredits: 0, remainingCredits: 5000, tariffRevision: 29 };
        await page.route('**/api/account/canvas/projects/**/agent/voice**', async route => {
            const request = route.request(), pathname = new URL(request.url()).pathname, input = request.postDataJSON(); calls.push({ pathname, method: request.method() }); let data = config;
            if (pathname.endsWith('/quote')) data = { quote: { id: 'c'.repeat(32), capCredits: 60, creditsPerBlock: 2, unitSeconds: 10, remainingConversationCredits: 5000, billingMode: 'session_elapsed', maxDurationSeconds: input.maxDurationSeconds, maxBillableSeconds: input.maxDurationSeconds, settingsRevision: input.settingsRevision, expiresAt: new Date(Date.now() + 60000).toISOString(), resumption: { enabled: false, resuming: false, expiresAt: null } } };
            if (pathname.endsWith('/sessions')) data = { session: { id: input.requestId, settings, socketPath: `${pathname}/${input.requestId}/socket` } };
            if (pathname.endsWith('/stop')) data = { stopRequested: true };
            await route.fulfill({ json: { ok: true, data } });
        });
        await page.reload(); await page.locator('#canvasAgentToggle').click();
        await composer.locator('textarea').fill('Retained text draft'); const graphBefore = JSON.stringify({ projects: canvas.projects, nodes: canvas.nodes, edges: canvas.edges });
        await page.evaluate(() => { const context = new AudioContext(), destination = context.createMediaStreamDestination(); window.syntheticContext = context; window.syntheticStream = destination.stream;
            document.querySelector('[data-canvas-voice="toggle"]').addEventListener('click', () => void context.resume(), { once: true });
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => destination.stream }); });
        await panel.locator('[data-canvas-voice="toggle"]').click(); const approval = page.getByRole('dialog');
        await expect(approval.getByRole('status')).toContainText(locale === 'de' ? '60 Credits' : '60 credits');
        await approval.getByRole('checkbox').check(); await approval.getByRole('button', { name: locale === 'de' ? 'Mikrofon freigeben und starten' : 'Allow microphone and start', exact: true }).click();
        await expect(panel.locator('.canvas-voice__status')).toHaveText(locale === 'de' ? 'Hört zu' : 'Listening');
        channel.send(JSON.stringify({ type: 'voice.transcript', text: 'A long, unsaved spoken contribution. '.repeat(80) }));
        await expect(panel.locator('.canvas-voice__interim')).toContainText('unsaved spoken contribution');
        {
            const bounds = await panel.evaluate(node => {
                const transcript = node.querySelector('.canvas-agent__transcript'), composer = node.querySelector('.canvas-agent__composer').getBoundingClientRect(), voice = node.querySelector('.canvas-agent__voice'), interim = node.querySelector('.canvas-voice__interim');
                return { transcriptHeight: transcript.clientHeight, composerBottom: composer.bottom, panelBottom: node.getBoundingClientRect().bottom, voiceHeight: voice.clientHeight, voiceScroll: voice.scrollHeight, interimHeight: interim.clientHeight, interimScroll: interim.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth };
            });
            expect(bounds.transcriptHeight).toBeGreaterThan(40); expect(bounds.composerBottom).toBeLessThanOrEqual(bounds.panelBottom); expect(bounds.composerBottom).toBeLessThanOrEqual(size.height); expect(bounds.overflow).toBe(false);
            expect(bounds.interimScroll).toBeGreaterThan(bounds.interimHeight); expect(bounds.voiceScroll).toBeGreaterThan(bounds.voiceHeight);
            await info.attach(`voice-active-layout-${locale}-${size.width}`, { contentType: 'application/json', body: JSON.stringify({ size, ...bounds }) });
            await panel.getByRole('button', { name: locale === 'de' ? 'Stummschalten' : 'Mute', exact: true }).click();
            await panel.getByRole('button', { name: locale === 'de' ? 'Mikrofon einschalten' : 'Unmute', exact: true }).click();
            await panel.getByRole('button', { name: locale === 'de' ? 'Sitzung beenden' : 'End session', exact: true }).click({ trial: true });
            await composer.locator('textarea').click(); await expect(composer.locator('textarea')).toHaveValue('Retained text draft');
            await panel.screenshot({ path: info.outputPath(`voice-active-${locale}-${size.width}.png`) });
        }
        await panel.getByRole('button', { name: 'Settings', exact: true }).click(); const settingsDialog = page.getByRole('dialog', { name: locale === 'de' ? 'Voice-Einstellungen' : 'Voice settings', exact: true }); await expect(settingsDialog).toBeVisible();
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('bitbi:auth-change', { detail: { ready: true, loggedIn: false, user: null, sessionConfirmed: false } })));
        await expect(settingsDialog).not.toBeVisible(); await expect(page.locator('.canvas-layout')).toHaveAttribute('inert', '');
        await expect.poll(() => closeCount).toBe(1); expect(frames.filter(frame => frame.type === 'voice.stop')).toHaveLength(1);
        expect(await page.evaluate(() => window.syntheticStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
        await expect(panel.locator('[data-canvas-voice="toggle"]')).toHaveAttribute('aria-pressed', 'false'); await expect(composer.locator('textarea')).toHaveValue('Retained text draft');
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('bitbi:auth-change', { detail: { ready: true, loggedIn: true, user: { id: 'canvas-member', role: 'user' }, sessionConfirmed: true } })));
        await expect(page.locator('.canvas-layout')).not.toHaveAttribute('inert', ''); await expect(composer.locator('textarea')).toHaveValue('Retained text draft');
        expect(calls.filter(call => call.pathname.endsWith('/sessions'))).toHaveLength(1); expect(state.chatPosts).toHaveLength(0); expect(state.posts).toHaveLength(0); expect(JSON.stringify({ projects: canvas.projects, nodes: canvas.nodes, edges: canvas.edges })).toBe(graphBefore);
        await page.evaluate(() => window.syntheticContext.close());
    });
    test('Canvas Voice stop fences late microphone permission without admitting a session', async ({ page }) => {
        const calls = await harness(page, false, { available: true });
        await page.evaluate(() => {
            const context = new AudioContext(), destination = context.createMediaStreamDestination(); window.syntheticContext = context; window.syntheticStream = destination.stream;
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: () => { window.micCalls++; return new Promise(resolve => { window.resolveMic = () => resolve(destination.stream); }); } });
        });
        await page.locator('[data-canvas-voice="toggle"]').click(); await expect(page.getByRole('dialog').getByRole('status')).toContainText('credits from your approved conversation allowance');
        await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByRole('button', { name: 'Allow microphone and start' }).click();
        await expect.poll(() => page.evaluate(() => window.micCalls)).toBe(1);
        await page.getByRole('button', { name: 'End session', exact: true }).click();
        await page.evaluate(async () => { window.resolveMic(); await new Promise(resolve => setTimeout(resolve, 80)); });
        expect(await page.evaluate(() => window.syntheticStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
        expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false);
        await expect(page.locator('[data-canvas-voice="toggle"]')).toHaveAttribute('aria-pressed', 'false');
        await page.evaluate(() => window.syntheticContext.close());
    });
    for (const mismatch of [false, true]) test(`Canvas Voice start pins settings across microphone wait: ${mismatch ? 'reject mismatched admission' : 'preserve original revision after settings save'}`, async ({ page }) => {
        let opened = 0; await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/, socket => { opened++; socket.close(); });
        const calls = await harness(page, false, { available: true, admission: async input => {
            if (!mismatch) return { status: 409, body: { ok: false, code: 'canvas_voice_settings_stale' } };
            const settings = await page.evaluate(() => structuredClone(window.voiceConfig.settings)); settings.audio.output.speed = 1.1;
            return { body: { ok: true, data: { session: { id: input.requestId, settings, socketPath: `/api/account/canvas/projects/${'1'.repeat(32)}/agent/voice/sessions/${input.requestId}/socket` } } } };
        } });
        await page.evaluate(() => { const context = new AudioContext(), destination = context.createMediaStreamDestination(); window.syntheticContext = context; window.syntheticStream = destination.stream;
            document.querySelector('#outside').addEventListener('click', () => void context.resume());
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: () => { window.micCalls++; return new Promise(resolve => { window.resolveMic = () => resolve(destination.stream); }); } }); });
        await page.locator('#outside').click(); await expect.poll(() => page.evaluate(() => window.syntheticContext.state)).toBe('running');
        await page.locator('[data-canvas-voice="toggle"]').click(); await expect(page.getByRole('dialog').getByRole('status')).toContainText('credits from your approved conversation allowance');
        await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByRole('button', { name: 'Allow microphone and start' }).click();
        await expect.poll(() => page.evaluate(() => window.micCalls)).toBe(1);
        if (!mismatch) {
            await page.getByRole('button', { name: 'Settings', exact: true }).click(); const dialog = page.getByRole('dialog');
            await dialog.locator('summary').filter({ hasText: /^Audio and advanced$/ }).click();
            await dialog.locator('[data-voice-setting="audio.input.format.type"]').selectOption('audio/pcmu');
            await dialog.getByRole('button', { name: 'Save settings', exact: true }).click(); await expect(dialog.locator('p[role=status]')).toContainText('Saved');
            await expect.poll(() => page.evaluate(() => window.voiceConfig.revision)).toBe(2); await page.keyboard.press('Escape');
        }
        await page.evaluate(() => window.resolveMic());
        await expect.poll(() => calls.filter(call => call.pathname.endsWith('/sessions')).length).toBe(1);
        expect(calls.find(call => call.pathname.endsWith('/sessions')).body.settingsRevision).toBe(1);
        await expect(page.locator('.canvas-voice__status')).toHaveAttribute('data-voice-error', mismatch ? 'canvas_voice_session_settings_mismatch' : 'canvas_voice_settings_stale');
        await expect.poll(() => calls.filter(call => call.pathname.endsWith('/stop')).length).toBe(1);
        expect(opened).toBe(0); expect(await page.evaluate(() => window.syntheticStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
        await page.evaluate(() => window.syntheticContext.close());
    });
    test('Canvas Voice browser commands cross the actual relay and preserve cumulative transcripts and cancellation', async ({ page }) => {
        const { CanvasVoiceRelay } = await import('../../workers/auth/src/lib/canvas-voice-relay.js');
        const { canvasVoiceSettings } = await import('../../js/shared/canvas-voice-settings.mjs');
        const provider = [], turns = [], stopped = []; let relay;
        await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/, socket => {
            relay = new CanvasVoiceRelay({ client: { send: text => socket.send(text), close: () => socket.close() }, provider: { send: text => provider.push(typeof text === 'string' ? JSON.parse(text) : text), close() {} },
                session: { settings: canvasVoiceSettings({ turn_detection: { type: null } }), expiresAt: new Date(Date.now() + 60000).toISOString() }, services: {
                    authorize: async () => true, configuration: () => ({ type: 'session.update', session: {} }), verifyConfiguration: async () => {}, active: async () => {}, seedContext: async () => ({ type: 'conversation.item.create' }),
                    recordExposure: async () => {}, userTurn: async value => { turns.push(value); return { id: 'saved_turn' }; }, interrupted: async () => {}, response: () => ({ type: 'response.create' }), ended: async value => stopped.push(value),
                } });
            socket.onMessage(message => void relay.clientMessage(message));
            void relay.providerMessage(JSON.stringify({ type: 'session.created', event_id: 'created' })).then(() => relay.providerMessage(JSON.stringify({ type: 'session.updated', event_id: 'configured', session: {} })));
        });
        const calls = await harness(page, false, { available: true });
        await page.evaluate(() => { window.voiceConfig.settings.turn_detection.type = null; window.voiceConfig.settings.turn_detection.idle_timeout_ms = null; });
        await page.evaluate(() => { const context = new AudioContext(), destination = context.createMediaStreamDestination(); window.syntheticContext = context; window.syntheticStream = destination.stream; document.querySelector('#outside').addEventListener('click', () => void context.resume()); Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => { window.micCalls++; return destination.stream; } }); });
        // Unlock the synthetic source under its own gesture; it is not the product's microphone/audio context.
        await page.locator('#outside').click(); await expect.poll(() => page.evaluate(() => window.syntheticContext.state)).toBe('running');
        await page.locator('[data-canvas-voice="toggle"]').click(); await expect(page.getByRole('dialog').getByRole('status')).toContainText('credits from your approved conversation allowance');
        await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByRole('button', { name: 'Allow microphone and start' }).click();
        await expect(page.locator('.canvas-voice__status')).toHaveText('Listening');
        await expect.poll(() => provider.some(message => message.type === 'input_audio_buffer.append')).toBe(true);
        await page.getByRole('button', { name: 'Finish speaking', exact: true }).click();
        await expect.poll(() => provider.filter(message => message.type === 'input_audio_buffer.commit').length).toBe(1);
        expect(provider.findIndex(message => message.type === 'input_audio_buffer.append')).toBeLessThan(provider.findIndex(message => message.type === 'input_audio_buffer.commit'));
        const finish = page.getByRole('button', { name: 'Finish speaking', exact: true }); await expect(finish).toBeDisabled();
        await finish.dispatchEvent('click'); expect(provider.filter(message => message.type === 'input_audio_buffer.commit')).toHaveLength(1);
        await page.getByRole('button', { name: 'Mute', exact: true }).click(); await expect(page.locator('.canvas-voice__status')).toHaveText('Microphone muted'); expect(relay.muted).toBe(true);
        await page.getByRole('button', { name: 'Unmute', exact: true }).click(); await expect(page.locator('.canvas-voice__status')).toHaveText('Listening'); await expect(finish).toBeDisabled();
        const emit = event => relay.providerMessage(JSON.stringify(event));
        await emit({ type: 'input_audio_buffer.committed', event_id: 'input_committed', item_id: 'spoken1' });
        await emit({ type: 'conversation.item.input_audio_transcription.updated', event_id: 'partial1', item_id: 'spoken1', transcript: 'A cat' });
        await emit({ type: 'conversation.item.input_audio_transcription.updated', event_id: 'partial2', item_id: 'spoken1', transcript: 'A cat film' });
        await expect(page.locator('.canvas-voice__interim')).toHaveText('A cat film');
        const complete = { type: 'conversation.item.input_audio_transcription.completed', event_id: 'complete1', item_id: 'spoken1', transcript: 'A cat film' };
        await emit(complete); await emit(complete); await expect.poll(() => page.evaluate(() => window.voiceChanged)).toBe(1); expect(turns).toHaveLength(1);
        await emit({ type: 'response.created', event_id: 'response_created', response: { id: 'response_1' } });
        await emit({ type: 'response.output_item.added', event_id: 'item_created', response_id: 'response_1', item: { id: 'reply_1', type: 'message' } });
        const pcm = Buffer.alloc(4800); for (let i = 0; i < 2400; i++) pcm.writeInt16LE(Math.round(4000 * Math.sin(i * Math.PI / 27)), i * 2);
        await emit({ type: 'response.output_audio.delta', event_id: 'audio_1', response_id: 'response_1', item_id: 'reply_1', delta: pcm.toString('base64') });
        await page.getByRole('button', { name: 'Interrupt', exact: true }).click();
        await expect.poll(() => provider.some(message => message.type === 'conversation.item.truncate')).toBe(true);
        expect(provider.find(message => message.type === 'conversation.item.truncate')).toMatchObject({ item_id: 'reply_1', content_index: 0 });
        expect(provider.find(message => message.type === 'conversation.item.truncate').audio_end_ms).toBeLessThanOrEqual(100);
        await expect(finish).toBeDisabled();
        await emit({ type: 'response.done', event_id: 'reply_done', response: { id: 'response_1', status: 'cancelled' } }); await expect(finish).toBeEnabled();
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'End session', exact: true }).click(); await expect.poll(() => stopped.length).toBe(1);
        expect(stopped[0].code).toBe('canvas_voice_stopped'); expect(provider.some(message => message.type === 'input_audio_buffer.append')).toBe(true);
        expect(calls.some(call => call.pathname.includes('/conversation/messages'))).toBe(false);
        expect(await page.evaluate(() => window.syntheticStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
        await page.evaluate(() => window.syntheticContext.close());
    });
    test('Canvas Voice keeps speaking until actual queued playback ends after provider response done', async ({ page }, info) => {
        const { CanvasVoiceRelay } = await import('../../workers/auth/src/lib/canvas-voice-relay.js');
        const { canvasVoiceSettings } = await import('../../js/shared/canvas-voice-settings.mjs'); let relay; const interruptions = [], upstream = [];
        await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/, socket => {
            relay = new CanvasVoiceRelay({ client: { send: text => socket.send(text), close: () => socket.close() }, provider: { send: text => upstream.push(JSON.parse(text)), close() {} },
                session: { settings: canvasVoiceSettings(), expiresAt: new Date(Date.now() + 60000).toISOString() }, services: {
                    authorize: async () => true, configuration: () => ({ type: 'session.update', session: {} }), verifyConfiguration: async () => {}, active: async () => {}, seedContext: async () => null,
                    recordExposure: async () => {}, interrupted: async value => interruptions.push(value), ended: async () => {},
                } }); socket.onMessage(message => void relay.clientMessage(message));
            void relay.providerMessage(JSON.stringify({ type: 'session.created' })).then(() => relay.providerMessage(JSON.stringify({ type: 'session.updated', session: {} })));
        });
        await harness(page, false, { available: true });
        await page.evaluate(() => {
            // Return real native nodes and delegate every method; observe actual
            // scheduling/cleanup without replacing the audio clock or callbacks.
            window.playbackNodes = []; const original = AudioContext.prototype.createBufferSource;
            AudioContext.prototype.createBufferSource = function (...args) {
                const node = original.apply(this, args), record = { node, context: this, stopped: false, disconnected: false, ended: false, samples: 0, rate: 0, at: null };
                const start = node.start.bind(node), stop = node.stop.bind(node), disconnect = node.disconnect.bind(node);
                node.start = (...values) => { record.samples = node.buffer.length; record.rate = node.buffer.sampleRate; record.at = values[0];
                    record.nonzero = node.buffer.getChannelData(0).some(sample => Math.abs(sample) > .01); return start(...values); };
                node.stop = (...values) => { record.stopped = true; return stop(...values); };
                node.disconnect = (...values) => { record.disconnected = true; return disconnect(...values); };
                node.addEventListener('ended', () => { record.ended = true; }); window.playbackNodes.push(record); return node;
            };
            const context = new AudioContext(), stream = context.createMediaStreamDestination().stream; window.syntheticContext = context; window.syntheticStream = stream;
            document.querySelector('#outside').addEventListener('click', () => void context.resume()); Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => stream }); });
        await page.locator('#outside').click(); await page.locator('[data-canvas-voice="toggle"]').click();
        const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('status')).toContainText('approved conversation allowance');
        await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Allow microphone and start', exact: true }).click(); await expect(page.locator('.canvas-voice__status')).toHaveText('Listening');
        const emit = value => relay.providerMessage(JSON.stringify(value));
        await emit({ type: 'response.created', response: { id: 'playback_response' } });
        await emit({ type: 'response.output_item.added', response_id: 'playback_response', item: { id: 'playback_item', type: 'message' } });
        const pcm = Buffer.alloc(72000); for (let index = 0; index < 36000; index++) pcm.writeInt16LE(Math.round(3000 * Math.sin(index * Math.PI / 27)), index * 2);
        await emit({ type: 'response.output_audio.delta', response_id: 'playback_response', item_id: 'playback_item', delta: pcm.toString('base64') });
        await expect(page.locator('.canvas-voice__status')).toHaveText('Speaking');
        await emit({ type: 'response.done', response: { id: 'playback_response', status: 'completed' } });
        await page.waitForTimeout(100); await expect(page.locator('.canvas-voice__status')).toHaveText('Speaking');
        await expect(page.locator('.canvas-voice__status')).toHaveText('Listening');
        expect(await page.evaluate(() => window.playbackNodes.length === 1 && window.playbackNodes[0].ended
            && window.playbackNodes[0].disconnected && window.playbackNodes[0].node.buffer === null)).toBe(true);
        const burstPcm = Buffer.alloc(96000); for (let index = 0; index < 48000; index++) burstPcm.writeInt16LE(Math.round(3000 * Math.sin(index * Math.PI / 27)), index * 2);
        const burst = async suffix => {
            const before = await page.evaluate(() => window.playbackNodes.length), responseId = 'burst_' + suffix, itemId = responseId + '_item';
            await emit({ type: 'response.created', response: { id: responseId } });
            await emit({ type: 'response.output_item.added', response_id: responseId, item: { id: itemId, type: 'message' } });
            for (let index = 0; index < 10; index++) await emit({ type: 'response.output_audio.delta', event_id: responseId + '_' + index,
                response_id: responseId, item_id: itemId, delta: burstPcm.toString('base64') });
            await emit({ type: 'response.done', response: { id: responseId, status: 'completed' } });
            await expect.poll(() => page.evaluate(() => window.playbackNodes.length)).toBe(before + 10);
            await expect(page.locator('.canvas-voice__status')).toHaveText('Speaking');
            expect(await page.locator('.canvas-voice__status').getAttribute('data-voice-error')).toBeNull();
            const measured = await page.evaluate(start => {
                const rows = window.playbackNodes.slice(start); return { seconds: rows.reduce((sum, row) => sum + row.samples / row.rate, 0),
                    span: rows.at(-1).at + rows.at(-1).samples / rows.at(-1).rate - rows[0].at,
                    ahead: rows.at(-1).at + rows.at(-1).samples / rows.at(-1).rate - rows.at(-1).context.currentTime,
                    nonzero: rows.every(row => row.nonzero), retainedBytes: rows.reduce((sum, row) => sum + (row.node.buffer?.length || 0) * 4, 0) };
            }, before);
            expect(measured.seconds).toBe(20); expect(measured.span).toBeCloseTo(20, 6);
            expect(measured.ahead).toBeGreaterThan(12); expect(measured.retainedBytes).toBeLessThanOrEqual(20 * 24000 * 4);
            expect(measured.retainedBytes).toBeGreaterThan(0); expect(measured.nonzero).toBe(true); return measured;
        };
        const interrupted = await burst('interrupt'); await page.getByRole('button', { name: 'Interrupt', exact: true }).click();
        await expect.poll(() => interruptions.length).toBe(1); await relay.queue;
        expect(interruptions[0]).toMatchObject({ responseId: 'burst_interrupt', itemId: 'burst_interrupt_item', interrupted: true });
        expect(interruptions[0].audioEndMs).toBeGreaterThanOrEqual(0); expect(interruptions[0].audioEndMs).toBeLessThan(20000);
        expect(upstream.filter(message => message.type === 'response.cancel')).toEqual([]);
        expect(upstream.filter(message => message.type === 'conversation.item.truncate')).toEqual([{ type: 'conversation.item.truncate',
            item_id: 'burst_interrupt_item', content_index: 0, audio_end_ms: interruptions[0].audioEndMs }]);
        await expect(page.locator('.canvas-voice__status')).toHaveText('Listening');
        expect(await page.evaluate(() => window.playbackNodes.every(row => row.disconnected && row.node.buffer === null))).toBe(true);
        const stopped = await burst('stop'); // The released budget can be used again in the same session.
        await page.locator('[data-canvas-voice="toggle"]').click();
        expect(await page.evaluate(() => window.syntheticStream.getTracks().every(track => track.readyState === 'ended')
            && window.playbackNodes.every(row => row.disconnected && row.node.buffer === null))).toBe(true);
        await page.evaluate(() => window.syntheticContext.close());
        const bounded = await page.evaluate(async () => {
            const { createCanvasVoiceAudio } = await import('/js/pages/canvas/voice-audio.js');
            const { canvasVoiceSettings } = await import('/js/shared/canvas-voice-settings.mjs');
            const source = new AudioContext(), stream = source.createMediaStreamDestination().stream, errors = [], before = window.playbackNodes.length;
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => stream });
            const audio = createCanvasVoiceAudio({ settings: canvasVoiceSettings(), onAudio: () => true, onError: error => errors.push(error.code) });
            await audio.open(); audio.ready();
            // Each valid192k-byte PCM frame decodes to384k bytes of Float32.
            // Twenty-one fit8MiB; the next must fail before allocating a node.
            const frame = btoa('\x01'.repeat(192000));
            for (let index = 0; index < 23; index++) audio.play({ audio: frame, event_id: 'memory_' + index, responseId: 'memory', itemId: 'memory_item' });
            const rows = window.playbackNodes.slice(before), result = { errors, stopped: audio.stopped(), playing: audio.playing(),
                nodes: rows.length, samples: rows.reduce((sum, row) => sum + row.samples, 0),
                released: rows.every(row => row.stopped && row.disconnected && row.node.buffer === null), tracksEnded: stream.getTracks().every(track => track.readyState === 'ended') };
            audio.stop(); await source.close(); return result;
        });
        expect(bounded.errors).toEqual(['canvas_voice_playback_backpressure']); expect(bounded.stopped).toBe(true); expect(bounded.playing).toBe(false);
        expect(bounded.nodes).toBe(21); expect(bounded.samples).toBe(21 * 96000); expect(bounded.released).toBe(true); expect(bounded.tracksEnded).toBe(true);
        await info.attach('real-browser-playback-bounds', { body: JSON.stringify({ interrupted, stopped, bounded }), contentType: 'application/json' });
    });
    for (const german of [false, true]) test(`Canvas Voice pending server stop ${german ? 'DE' : 'EN'} remains unconfirmed after HTTP success`, async ({ page }) => {
        await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/, socket => { socket.onMessage(() => {}); socket.send(JSON.stringify({ type: 'voice.state', state: 'listening' })); });
        const calls = await harness(page, german, { available: true, termination: { stopped: false, stopRequested: true } });
        await page.evaluate(() => { const context = new AudioContext(), stream = context.createMediaStreamDestination().stream; window.syntheticContext = context; window.syntheticStream = stream;
            document.querySelector('#outside').addEventListener('click', () => void context.resume()); Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => stream }); });
        await page.locator('#outside').click(); await page.locator('[data-canvas-voice="toggle"]').click();
        const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('status')).toContainText(german ? 'freigegebenen Gesprächslimit' : 'approved conversation allowance');
        await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: german ? 'Mikrofon freigeben und starten' : 'Allow microphone and start', exact: true }).click();
        await expect(page.locator('.canvas-voice__status')).toHaveText(german ? 'Hört zu' : 'Listening'); await page.locator('[data-canvas-voice="toggle"]').click();
        await expect(page.locator('.canvas-voice__status')).toHaveText(german ? 'Aufnahme beendet. Die serverseitige Beendigung ist noch nicht bestätigt.' : 'Recording stopped. Server-side termination has not yet been confirmed.');
        expect(calls.filter(call => call.pathname.endsWith('/stop'))).toHaveLength(1); expect(calls.filter(call => call.pathname.endsWith('/sessions'))).toHaveLength(1);
        expect(await page.evaluate(() => window.syntheticStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true); await page.evaluate(() => window.syntheticContext.close());
    });
    test('Canvas Voice ended reasons remain truthful without exposing provider messages', async ({ page }) => {
        let channel; await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/, socket => { channel = socket; socket.onMessage(() => {}); socket.send(JSON.stringify({ type: 'voice.state', state: 'listening' })); });
        await harness(page, false, { available: true });
        await page.evaluate(() => { const context = new AudioContext(); window.syntheticContext = context; window.syntheticStreams = [];
            document.querySelector('#outside').addEventListener('click', () => void context.resume());
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => { const stream = context.createMediaStreamDestination().stream; window.syntheticStreams.push(stream); return stream; } }); });
        await page.locator('#outside').click();
        for (const [code, expected] of [['canvas_voice_provider_error', 'voice provider reported an error'], ['canvas_voice_configuration_unconfirmed', 'did not confirm'], ['canvas_voice_authority_changed', 'Authorization or project state changed'], ['canvas_voice_context_changed', 'The conversation changed'], ['canvas_voice_session_limit', 'approved session duration'], ['unknown private provider text', 'could not be processed safely']]) {
            await page.locator('[data-canvas-voice="toggle"]').click(); await expect(page.getByRole('dialog').getByRole('status')).toContainText('credits from your approved conversation allowance');
            await page.getByRole('dialog').getByRole('checkbox').check(); await page.getByRole('button', { name: 'Allow microphone and start' }).click();
            await expect(page.locator('.canvas-voice__status')).toHaveText('Listening');
            channel.send(JSON.stringify({ type: 'voice.ended', code, message: 'private server prompt' }));
            await expect(page.locator('.canvas-voice__status')).toContainText(expected); await expect(page.locator('[data-canvas-voice="toggle"]')).toHaveAttribute('aria-pressed', 'false');
            await expect(page.locator('#voiceRoot')).not.toContainText('private');
        }
        expect(await page.evaluate(() => window.syntheticStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
        await page.evaluate(() => window.syntheticContext.close());
    });
    test('Canvas Voice cleanup releases native tracks after closed decoder and partial codec failures', async ({ page }) => {
        await harness(page, false);
        const result = await page.evaluate(async () => {
            const { createCanvasVoiceAudio } = await import('/js/pages/canvas/voice-audio.js'); const { createCanvasVoiceOpus } = await import('/js/pages/canvas/voice-opus.js');
            const { canvasVoiceSettings } = await import('/js/shared/canvas-voice-settings.mjs');
            const NativeAudio = AudioContext, sourceContext = new NativeAudio(), contexts = [], closings = [], encoders = [], decoders = [], errors = []; let failConfigure = false, resetCalls = 0, disconnects = 0;
            window.AudioContext = class extends NativeAudio { constructor(...args) { super(...args); contexts.push(this); } close() { const closing = super.close(); closings.push(closing); return closing; } };
            const NativeWorklet = AudioWorkletNode; window.AudioWorkletNode = class extends NativeWorklet { disconnect(...args) { super.disconnect(...args); disconnects++; throw new DOMException('Synthetic already disconnected', 'InvalidStateError'); } };
            window.AudioEncoder = class { static async isConfigSupported(config) { return { supported: true, config }; } constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; encoders.push(this); } configure() { this.state = 'configured'; } close() { this.state = 'closed'; } };
            window.AudioDecoder = class { static async isConfigSupported() { return { supported: true }; } constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; decoders.push(this); } configure() { if (failConfigure) throw new Error('synthetic_config_failure'); this.state = 'configured'; } close() { this.state = 'closed'; } reset() { resetCalls++; if (this.state === 'closed') throw new DOMException('Decoder closed', 'InvalidStateError'); } };
            let stream = sourceContext.createMediaStreamDestination().stream; await sourceContext.resume();
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => stream });
            const positive = createCanvasVoiceAudio({ settings: canvasVoiceSettings(), onAudio: () => true, onError: error => errors.push(error.message) }); await positive.open(); positive.stop(); await Promise.all(closings);
            const positiveClosed = contexts[0].state === 'closed' && stream.getTracks().every(track => track.readyState === 'ended');
            stream = sourceContext.createMediaStreamDestination().stream;
            const audio = createCanvasVoiceAudio({ settings: canvasVoiceSettings({ audio: { output: { format: { type: 'audio/opus', rate: 24000 } } } }), onAudio: () => true, onError: error => errors.push(error.message) }); await audio.open();
            decoders.at(-1).state = 'closed'; let thrown = null; try { decoders.at(-1).callbacks.error(new Error('synthetic_decoder_failure')); } catch (error) { thrown = error.name; } audio.stop(); await Promise.all(closings);
            const fatalClosed = contexts[1].state === 'closed' && stream.getTracks().every(track => track.readyState === 'ended');
            failConfigure = true; let initializationError = null;
            try { await createCanvasVoiceOpus({ encode: true, decode: true, onPacket() {}, onSamples() {}, onError() {} }); } catch (error) { initializationError = error.message; }
            const partialClosed = encoders.at(-1).state === 'closed' && decoders.at(-1).state === 'closed';
            for (const context of contexts) if (context.state !== 'closed') await context.close(); stream.getTracks().forEach(track => track.stop()); await sourceContext.close();
            return { positiveClosed, fatalClosed, partialClosed, resetCalls, thrown, initializationError, errors, disconnects };
        });
        expect(result).toMatchObject({ positiveClosed: true, fatalClosed: true, partialClosed: true, resetCalls: 0, thrown: null, initializationError: 'synthetic_config_failure', errors: ['synthetic_decoder_failure'], disconnects: 2 });
    });
    for (const german of [false, true]) test(`Canvas Voice key terms ${german ? 'DE' : 'EN'} retain per-line values and enforce item limits`, async ({ page }) => {
        const calls = await harness(page, german); await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const dialog = page.getByRole('dialog'), input = dialog.locator('[data-voice-setting="audio.input.transcription.keyterms"]'), save = dialog.getByRole('button', { name: german ? 'Einstellungen übernehmen' : 'Save settings', exact: true });
        const valid = ['A'.repeat(50), 'Washington, D.C.', 'B'.repeat(50)]; await input.pressSequentially(valid.join('\n'));
        await expect(input).toHaveValue(valid.join('\n')); await save.click(); await expect(dialog.locator('p[role=status]')).toContainText(german ? 'Gespeichert' : 'Saved');
        expect(calls.find(call => call.pathname.endsWith('/settings')).body.settings.audio.input.transcription.keyterms).toEqual(valid);
        await input.fill('A'.repeat(51)); await save.click(); await expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(calls.filter(call => call.pathname.endsWith('/settings'))).toHaveLength(1);
        const boundary = Array.from({ length: 100 }, (_, index) => `term${index}`); await input.fill(boundary.join('\n')); await save.click(); await expect(dialog.locator('p[role=status]')).toContainText(german ? 'Gespeichert' : 'Saved');
        expect(calls.filter(call => call.pathname.endsWith('/settings')).at(-1).body.settings.audio.input.transcription.keyterms).toEqual(boundary);
        await input.fill([...boundary, 'term100'].join('\n')); await save.click(); await expect(input).toHaveAttribute('aria-invalid', 'true'); await expect(input).toBeFocused();
        expect(calls.filter(call => call.pathname.endsWith('/settings'))).toHaveLength(2); expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false);
    });
    test('Canvas Voice unsupported Opus stays disabled after settings save and fails before microphone admission', async ({ page }) => {
        const calls = await harness(page, false, { available: true });
        await page.evaluate(() => { window.AudioEncoder = undefined; Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => { window.micCalls++; throw new Error('microphone must not be requested'); } }); });
        await page.getByRole('button', { name: 'Settings', exact: true }).click(); const dialog = page.getByRole('dialog');
        await dialog.locator('summary').filter({ hasText: /^Audio and advanced$/ }).click();
        for (const side of ['input', 'output']) await expect(dialog.locator(`[data-voice-setting="audio.${side}.format.type"] option[value="audio/opus"]`)).toBeDisabled();
        await dialog.getByRole('button', { name: 'Save settings', exact: true }).click(); await expect(dialog.locator('p[role=status]')).toContainText('Saved');
        for (const side of ['input', 'output']) await expect(dialog.locator(`[data-voice-setting="audio.${side}.format.type"] option[value="audio/opus"]`)).toBeDisabled();
        await page.keyboard.press('Escape');
        await page.evaluate(() => { window.voiceConfig.settings.audio.input.format = { type: 'audio/opus', rate: 24000 }; });
        await page.locator('[data-canvas-voice="toggle"]').click(); await expect(dialog.getByRole('status')).toContainText('approved conversation allowance');
        await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Allow microphone and start', exact: true }).click();
        await expect(page.locator('.canvas-voice__status')).toContainText('This browser cannot fully capture and play Opus audio');
        expect(await page.evaluate(() => window.micCalls)).toBe(0); expect(calls.some(call => call.pathname.endsWith('/sessions'))).toBe(false);
    });
    test('Canvas Voice real AudioWorklet and raw Opus browser pipeline uses synthetic audio and releases tracks', async ({ page }, info) => {
        await harness(page, false);
        const result = await page.evaluate(async () => {
            const { createCanvasVoiceAudio } = await import('/js/pages/canvas/voice-audio.js');
            const { createCanvasVoiceOpus, canvasVoiceOpusSupport, opusPacketDuration } = await import('/js/pages/canvas/voice-opus.js');
            const { canvasVoiceSettings } = await import('/js/shared/canvas-voice-settings.mjs');
            const sourceContext = new AudioContext({ sampleRate: 48000 }), oscillator = sourceContext.createOscillator(), destination = sourceContext.createMediaStreamDestination();
            oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start(); await sourceContext.resume();
            Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => destination.stream });
            const packets = [], errors = [], samples = [], settings = canvasVoiceSettings({ audio: { input: { format: { type: 'audio/opus', rate: 24000 } }, output: { format: { type: 'audio/opus', rate: 24000 } } } });
            const audio = createCanvasVoiceAudio({ settings, onAudio: value => { packets.push(value); return true; }, onError: error => errors.push(error.code || error.message) });
            await audio.open(); audio.ready();
            const deadline = performance.now() + 3000; while (packets.length < 20 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
            const codec = await createCanvasVoiceOpus({ encode: false, decode: true, onError: error => errors.push(error.message), onSamples: (data, rate) => samples.push({ count: data.length, rate, rms: Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length) }) });
            const finalPackets = packets.slice();
            for (let i = 0; i < finalPackets.length; i++) { const raw = atob(finalPackets[i]), bytes = Uint8Array.from(raw, char => char.charCodeAt(0)); codec.play(bytes, { itemId: 'synthetic' }); audio.play({ event_id: `audio${i}`, audio: finalPackets[i], itemId: 'synthetic', responseId: 'response1' }); }
            const end = performance.now() + 1500; while (samples.length < finalPackets.length && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 30));
            const heard = audio.interrupt(); audio.mute(true); audio.stop(); codec.close(); oscillator.stop(); await sourceContext.close();
            const silence = []; let control; control = await createCanvasVoiceOpus({ encode: true, decode: true, onError: error => errors.push(error.message), onPacket: bytes => control.play(bytes, {}), onSamples: data => silence.push(Math.max(...data.map(Math.abs))) });
            control.append(new Float32Array(1440 * 8)); await control.flush(); const controlEnd = performance.now() + 1000; while (silence.length < 8 && performance.now() < controlEnd) await new Promise(resolve => setTimeout(resolve, 20)); control.close();
            return { supported: await canvasVoiceOpusSupport(), packets: finalPackets.length, samples, silence, heard, errors, tracksEnded: destination.stream.getTracks().every(track => track.readyState === 'ended'), packetDuration: opusPacketDuration(Uint8Array.from(atob(packets[0] || ''), char => char.charCodeAt(0))) };
        });
        await info.attach('synthetic-audio-boundary', { body: JSON.stringify(result), contentType: 'application/json' });
        expect(result.supported).toBe(true); expect(result.errors).toEqual([]); expect(result.packets).toBeGreaterThanOrEqual(20); expect(result.samples).toHaveLength(result.packets);
        // The native decoder may output48k (Chromium) or24k (WebKit). Measure
        // duration from its actual rate, independently of the requested rate.
        expect(result.samples.every(sample => sample.count / sample.rate === .06)).toBe(true);
        expect(result.samples.slice(-5).every(sample => sample.rms > .05)).toBe(true); expect(result.silence.length).toBeGreaterThanOrEqual(8); expect(Math.max(...result.silence)).toBeLessThan(.0001); expect(result.packetDuration).toBe(60); expect(result.tracksEnded).toBe(true); expect(result.heard.itemId).toBe('synthetic');
    });
    test('Canvas Voice real AudioWorklet batches PCM and G711, flushes tails and preserves mute and manual pause', async ({ page }, info) => {
        await harness(page, false);
        const results = await page.evaluate(async () => {
            const { createCanvasVoiceAudio } = await import('/js/pages/canvas/voice-audio.js');
            const { canvasVoiceSettings } = await import('/js/shared/canvas-voice-settings.mjs');
            const { decodeVoiceAudio } = await import('/js/shared/canvas-voice-audio.mjs');
            const results = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
            for (const type of ['audio/pcm', 'audio/pcmu', 'audio/pcma']) {
                const sourceContext = new AudioContext({ sampleRate: 48000 }), oscillator = sourceContext.createOscillator(), destination = sourceContext.createMediaStreamDestination();
                oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start(); await sourceContext.resume();
                Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => destination.stream });
                const packets = [], errors = [], rate = type === 'audio/pcm' ? 24000 : 8000;
                const audio = createCanvasVoiceAudio({ settings: canvasVoiceSettings({ audio: { input: { format: { type, rate } } } }), onAudio(value) { packets.push({ value, at: performance.now() }); return true; }, onError: error => errors.push(error.code || error.message) });
                await audio.open(); audio.ready();
                const deadline = performance.now() + 2000; while (packets.length < 3 && performance.now() < deadline) await wait(20);
                await audio.finishTurn(); const completed = packets.slice(), pausedCount = packets.length;
                audio.mute(true); audio.mute(false); await wait(150); const afterUnmute = packets.length;
                audio.continueCapture(); const resumedUntil = performance.now() + 2000; while (packets.length < pausedCount + 2 && performance.now() < resumedUntil) await wait(20);
                const beforeStop = packets.length; audio.stop(); audio.ready(); audio.continueCapture(); audio.mute(false); await wait(100);
                results.push({ type, rate, errors, pausedCount, afterUnmute, beforeStop, afterStop: packets.length,
                    packets: completed.map(packet => { const bytes = Uint8Array.from(atob(packet.value), char => char.charCodeAt(0)), samples = decodeVoiceAudio(bytes, type); return { count: samples.length, rms: Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length), at: packet.at }; }),
                    tracksEnded: destination.stream.getTracks().every(track => track.readyState === 'ended') });
                oscillator.stop(); await sourceContext.close();
            }
            return results;
        });
        await info.attach('synthetic-pcm-g711-boundary', { body: JSON.stringify(results), contentType: 'application/json' });
        for (const result of results) {
            expect(result.errors).toEqual([]); expect(result.packets.length).toBeGreaterThanOrEqual(3);
            expect(result.packets.slice(0, -1).every(packet => packet.count === result.rate / 10)).toBe(true);
            expect(result.packets.at(-1).count).toBeGreaterThan(0); expect(result.packets.at(-1).count).toBeLessThanOrEqual(result.rate / 10);
            expect(result.packets[1].rms).toBeGreaterThan(.05); expect(result.afterUnmute).toBe(result.pausedCount);
            expect(result.beforeStop).toBeGreaterThanOrEqual(result.pausedCount + 2); expect(result.afterStop).toBe(result.beforeStop); expect(result.tracksEnded).toBe(true);
        }
    });
}
module.exports = { registerCanvasVoiceTests };
